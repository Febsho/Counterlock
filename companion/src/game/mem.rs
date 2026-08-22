//! Read-only access to the game process on Linux.
//!
//! Reads go through `/proc/<pid>/mem`, which is gated by the same
//! `PTRACE_MODE_ATTACH` check as `ptrace(2)`: with `kernel.yama.ptrace_scope=1`
//! a non-parent process needs `CAP_SYS_PTRACE`. No `ptrace` request is ever
//! issued and nothing is written back into the target.

use anyhow::{anyhow, Context, Result};
use std::collections::BTreeMap;
use std::fs::File;
use std::os::unix::fs::FileExt;
use std::path::Path;

/// A mapped module (`client.dll`, `engine2.dll`, …) inside the game process.
#[derive(Debug, Clone)]
pub struct Module {
    pub base: u64,
    pub end: u64,
}

impl Module {
    pub fn size(&self) -> u64 {
        self.end.saturating_sub(self.base)
    }
}

/// An open read handle on the game process.
pub struct ProcessMemory {
    pid: u32,
    mem: File,
}

impl ProcessMemory {
    pub fn open(pid: u32) -> Result<Self> {
        let path = format!("/proc/{pid}/mem");
        let mem = File::open(&path)
            .with_context(|| format!("opening {path}; {}", ptrace_scope_hint()))?;
        Ok(Self { pid, mem })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn alive(&self) -> bool {
        Path::new(&format!("/proc/{}", self.pid)).exists()
    }

    fn read_into(&self, addr: u64, buf: &mut [u8]) -> Result<()> {
        if addr == 0 {
            return Err(anyhow!("refusing a null read"));
        }
        self.mem
            .read_exact_at(buf, addr)
            .with_context(|| format!("reading {} bytes at {addr:#x}", buf.len()))
    }

    pub fn read_u64(&self, addr: u64) -> Result<u64> {
        let mut buf = [0u8; 8];
        self.read_into(addr, &mut buf)?;
        Ok(u64::from_le_bytes(buf))
    }

    pub fn read_u32(&self, addr: u64) -> Result<u32> {
        let mut buf = [0u8; 4];
        self.read_into(addr, &mut buf)?;
        Ok(u32::from_le_bytes(buf))
    }

    pub fn read_u8(&self, addr: u64) -> Result<u8> {
        let mut buf = [0u8; 1];
        self.read_into(addr, &mut buf)?;
        Ok(buf[0])
    }

    pub fn read_f32(&self, addr: u64) -> Result<f32> {
        Ok(f32::from_bits(self.read_u32(addr)?))
    }

    /// Follows a pointer, yielding `None` for null or non-canonical values.
    pub fn read_ptr(&self, addr: u64) -> Result<Option<u64>> {
        let value = self.read_u64(addr)?;
        Ok(plausible_pointer(value).then_some(value))
    }
}

/// Userspace pointers on x86-64 sit below the canonical hole. Anything outside
/// this range is a stale offset reading garbage, not an address.
pub fn plausible_pointer(value: u64) -> bool {
    (0x10000..0x0000_7fff_ffff_ffff).contains(&value)
}

/// Parses `/proc/<pid>/maps` into a module map keyed by lowercase file name.
///
/// A module spans several mappings (text, rodata, data); they are merged so the
/// base is the lowest mapped address, which is what offsets are relative to.
pub fn read_modules(pid: u32) -> Result<BTreeMap<String, Module>> {
    let raw = std::fs::read_to_string(format!("/proc/{pid}/maps"))
        .with_context(|| format!("reading /proc/{pid}/maps"))?;
    let mut modules: BTreeMap<String, Module> = BTreeMap::new();
    for line in raw.lines() {
        let mut fields = line.split_whitespace();
        let range = fields.next().unwrap_or_default();
        // Fields are: range perms offset dev inode path.
        let path = match fields.nth(4) {
            Some(path) if path.starts_with('/') => path,
            _ => continue,
        };
        let Some(name) = Path::new(path).file_name() else {
            continue;
        };
        let name = name.to_string_lossy().to_ascii_lowercase();
        let Some((start, end)) = range.split_once('-') else {
            continue;
        };
        let (Ok(start), Ok(end)) = (u64::from_str_radix(start, 16), u64::from_str_radix(end, 16))
        else {
            continue;
        };
        if start == 0 || end <= start {
            continue;
        }
        modules
            .entry(name)
            .and_modify(|module| {
                module.base = module.base.min(start);
                module.end = module.end.max(end);
            })
            .or_insert(Module { base: start, end });
    }
    Ok(modules)
}

/// Actionable guidance for the most common reason reads are refused.
pub fn ptrace_scope_hint() -> String {
    let scope = std::fs::read_to_string("/proc/sys/kernel/yama/ptrace_scope")
        .ok()
        .and_then(|raw| raw.trim().parse::<u8>().ok())
        .unwrap_or(0);
    if scope == 0 {
        return "reading another process's memory was refused".to_string();
    }
    format!(
        "kernel.yama.ptrace_scope is {scope}, so reading another process needs \
         CAP_SYS_PTRACE: run `sudo setcap cap_sys_ptrace+ep` on this binary. \
         Note the shipped systemd unit blocks this on purpose"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_canonical_pointers() {
        assert!(!plausible_pointer(0));
        assert!(!plausible_pointer(0x40));
        assert!(!plausible_pointer(u64::MAX));
        assert!(plausible_pointer(0x7f2c_11a4_b3d0));
    }

    #[test]
    fn reads_the_module_map_of_this_process() {
        let modules = read_modules(std::process::id()).expect("own maps are readable");
        assert!(
            !modules.is_empty(),
            "a running process always maps at least its own executable"
        );
        assert!(modules.values().all(|module| module.size() > 0));
    }

    #[test]
    fn the_scope_hint_names_a_remedy() {
        assert!(ptrace_scope_hint().len() > 20);
    }
}
