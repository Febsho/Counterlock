//! Read-only access to the game process on Linux and Windows.
//!
//! Linux uses `/proc/<pid>/mem`; Windows uses `ReadProcessMemory`. Both paths
//! are strictly read-only and never inject code or write back into the target.

use anyhow::{anyhow, Context, Result};
use std::collections::BTreeMap;
#[cfg(unix)]
use std::fs::File;
#[cfg(unix)]
use std::os::unix::fs::FileExt;
#[cfg(unix)]
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
    #[cfg(unix)]
    mem: File,
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

impl ProcessMemory {
    pub fn open(pid: u32) -> Result<Self> {
        #[cfg(unix)]
        {
            let path = format!("/proc/{pid}/mem");
            let mem = File::open(&path)
                .with_context(|| format!("opening {path}; {}", ptrace_scope_hint()))?;
            Ok(Self { pid, mem })
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::Threading::{
                OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
            };
            // SAFETY: the returned process handle is owned by this ProcessMemory.
            let handle =
                unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid) };
            if handle.is_null() {
                return Err(std::io::Error::last_os_error()).with_context(|| {
                    format!(
                        "opening Deadlock process {pid} for read-only access; {}",
                        ptrace_scope_hint()
                    )
                });
            }
            Ok(Self { pid, handle })
        }
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn alive(&self) -> bool {
        #[cfg(unix)]
        {
            Path::new(&format!("/proc/{}", self.pid)).exists()
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::STILL_ACTIVE;
            use windows_sys::Win32::System::Threading::GetExitCodeProcess;
            let mut code = 0u32;
            // SAFETY: the handle is owned by self and code is valid writable storage.
            unsafe {
                GetExitCodeProcess(self.handle, &mut code) != 0 && code == STILL_ACTIVE as u32
            }
        }
    }

    fn read_into(&self, addr: u64, buf: &mut [u8]) -> Result<()> {
        if addr == 0 {
            return Err(anyhow!("refusing a null read"));
        }
        #[cfg(unix)]
        self.mem
            .read_exact_at(buf, addr)
            .with_context(|| format!("reading {} bytes at {addr:#x}", buf.len()))?;
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
            let mut read = 0usize;
            // SAFETY: the OS copies target bytes into this caller-owned buffer; no target writes occur.
            let ok = unsafe {
                ReadProcessMemory(
                    self.handle,
                    addr as *const _,
                    buf.as_mut_ptr().cast(),
                    buf.len(),
                    &mut read,
                )
            };
            if ok == 0 || read != buf.len() {
                return Err(std::io::Error::last_os_error())
                    .with_context(|| format!("reading {} bytes at {addr:#x}", buf.len()));
            }
        }
        Ok(())
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
    #[cfg(unix)]
    {
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
            let (Ok(start), Ok(end)) =
                (u64::from_str_radix(start, 16), u64::from_str_radix(end, 16))
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
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStringExt;
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W,
            TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32,
        };
        // SAFETY: this requests an OS-owned snapshot handle for module enumeration.
        let snapshot =
            unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error())
                .with_context(|| format!("enumerating modules for process {pid}"));
        }
        struct SnapshotHandle(windows_sys::Win32::Foundation::HANDLE);
        impl Drop for SnapshotHandle {
            fn drop(&mut self) {
                // SAFETY: this wrapper owns the snapshot handle.
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
        let _snapshot = SnapshotHandle(snapshot);
        let mut entry: MODULEENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<MODULEENTRY32W>() as u32;
        let mut modules = BTreeMap::new();
        // SAFETY: entry is initialized with the required structure size.
        let mut found = unsafe { Module32FirstW(snapshot, &mut entry) } != 0;
        while found {
            if !entry.modBaseAddr.is_null() && entry.modBaseSize > 0 {
                let base = entry.modBaseAddr as usize as u64;
                let name = std::ffi::OsString::from_wide(&entry.szModule)
                    .to_string_lossy()
                    .trim_end_matches('\0')
                    .to_ascii_lowercase();
                if !name.is_empty() {
                    modules.insert(
                        name,
                        Module {
                            base,
                            end: base.saturating_add(u64::from(entry.modBaseSize)),
                        },
                    );
                }
            }
            entry.dwSize = std::mem::size_of::<MODULEENTRY32W>() as u32;
            // SAFETY: entry remains a valid, correctly sized output structure.
            found = unsafe { Module32NextW(snapshot, &mut entry) } != 0;
        }
        if modules.is_empty() {
            return Err(std::io::Error::last_os_error())
                .with_context(|| format!("Deadlock modules were not readable for process {pid}"));
        }
        Ok(modules)
    }
}

/// Actionable guidance for the most common reason reads are refused.
pub fn ptrace_scope_hint() -> String {
    #[cfg(unix)]
    {
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
    #[cfg(windows)]
    {
        "Windows refused read-only process access; run Counterlock and Deadlock at the same privilege level".to_string()
    }
}

#[cfg(windows)]
impl Drop for ProcessMemory {
    fn drop(&mut self) {
        // SAFETY: this object owns the handle returned by OpenProcess.
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
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

    #[cfg(unix)]
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
