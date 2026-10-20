# Keep Screen & System Awake while Job Bot Scheduler runs
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ScreenKeeper {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
    public const uint ES_CONTINUOUS = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED = 0x00000001;
    public const uint ES_DISPLAY_REQUIRED = 0x00000002;
    public static void KeepAwake() {
        SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
    }
}
"@

Write-Host "💡 [Screen Keeper] Active: Laptop display and system sleep are locked AWAKE."
Write-Host "💡 Screen will stay ON to ensure background job automation never pauses."

while ($true) {
    [ScreenKeeper]::KeepAwake()
    Start-Sleep -Seconds 30
}
