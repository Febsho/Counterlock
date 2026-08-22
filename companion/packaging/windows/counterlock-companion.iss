; Inno Setup script for the Counterlock companion.
;
; Produces a per-user installer: no administrator rights, no service, no
; firewall rule (the companion binds 127.0.0.1, which Windows does not filter).
;
; Build:   iscc counterlock-companion.iss
; Signing: see SignTool below and docs/PACKAGING.md. The installer is unsigned
;          unless you supply your own Authenticode certificate.

#define AppName "Counterlock Companion"
#define AppVersion "0.1.0"
#define AppPublisher "Counterlock"
#define AppExeName "counterlock-companion.exe"
#define AppUrl "https://github.com/Febsho/deadlock-counterlock"

[Setup]
AppId={{7F3C1B24-9A6E-4D51-8C0B-2E4A9F5D7C13}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppSupportURL={#AppUrl}
DefaultDirName={autopf}\Counterlock Companion
DefaultGroupName={#AppName}
OutputBaseFilename=counterlock-companion-setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Per-user install keeps the whole flow free of UAC prompts.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "startup"; Description: "Start automatically when I sign in"; GroupDescription: "Startup"; Flags: unchecked
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\target\x86_64-pc-windows-msvc\release\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\config.example.toml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme

[Dirs]
Name: "{userappdata}\counterlock"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Open Counterlock"; Filename: "http://127.0.0.1:9876"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
; Background startup without a service: a hidden-window Run entry. The companion
; is a normal user process, so no Windows Service and no elevation are involved.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "CounterlockCompanion"; \
    ValueData: """{app}\{#AppExeName}"""; Flags: uninsdeletevalue; Tasks: startup

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Start the companion now"; Flags: nowait postinstall skipifsilent
Filename: "http://127.0.0.1:9876"; Description: "Open Counterlock"; Flags: shellexec nowait postinstall skipifsilent unchecked

[UninstallRun]
; Stop a running instance so the uninstaller can remove the binary.
Filename: "taskkill.exe"; Parameters: "/IM {#AppExeName} /F"; Flags: runhidden skipifdoesntexist

[Code]
// The config file lives in %APPDATA% and is preserved across upgrades; seed it
// from the example only on a first install.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ConfigPath: string;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{userappdata}\counterlock\companion.toml');
    if not FileExists(ConfigPath) then
      FileCopy(ExpandConstant('{app}\config.example.toml'), ConfigPath, False);
  end;
end;
