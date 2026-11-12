param([switch]$Install)

$ErrorActionPreference = 'Stop'
$taskName = 'ChroniclerLabHost'

if ($Install) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        throw "Task $taskName already exists. Inspect it before changing its configuration."
    }
    $operatorName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
        '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $PSCommandPath + '"'
    )
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $operatorName
    $principal = New-ScheduledTaskPrincipal -UserId $operatorName -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Output "Installed and started $taskName for the current Windows user."
    exit
}

Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class ChroniclerHostPower {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@

# Prevent idle system sleep while hosting; do not change the user's power plan.
if ([ChroniclerHostPower]::SetThreadExecutionState([uint32]2147483649) -eq 0) {
    throw 'Could not establish the hosting sleep guard.'
}
try {
    $linuxScript = & wsl.exe -d Ubuntu --cd / --exec wslpath -a -u (Join-Path $PSScriptRoot 'host-session.sh')
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the WSL hosting script.' }
    & wsl.exe -d Ubuntu --cd / --exec bash $linuxScript.Trim()
    if ($LASTEXITCODE -ne 0) { throw "Chronicler host session exited with code $LASTEXITCODE." }
} finally {
    [void][ChroniclerHostPower]::SetThreadExecutionState([uint32]2147483648)
}
