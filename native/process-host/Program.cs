using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

// Separate from the closed UI Automation helper. One host owns exactly one
// anonymous job. No PID-based kill, breakaway flag, elevation or shell fallback.
internal static class Program
{
    private static readonly object OutputLock = new();
    private static void Emit(object value) { lock (OutputLock) { Console.WriteLine(JsonSerializer.Serialize(value)); Console.Out.Flush(); } }
    private sealed record Request(string file, string[] args, string cwd, Dictionary<string, string> env, bool windowsVerbatimArguments = false, bool visible = false);
    private static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public static async Task<int> Main()
    {
        Console.InputEncoding = Console.OutputEncoding = new UTF8Encoding(false);
        IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero, jobList = IntPtr.Zero, handles = IntPtr.Zero, environment = IntPtr.Zero;
        PROCESS_INFORMATION pi = default;
        IntPtr outRead = IntPtr.Zero, outWrite = IntPtr.Zero, errRead = IntPtr.Zero, errWrite = IntPtr.Zero, nul = IntPtr.Zero;
        bool created = false;
        try
        {
            var line = Console.ReadLine();
            if (line is null || line.Length > 1024 * 1024) throw new ArgumentException("Invalid launch request");
            var req = JsonSerializer.Deserialize<Request>(line) ?? throw new ArgumentException("Missing request");
            if (!Path.IsPathFullyQualified(req.file) || !Path.IsPathFullyQualified(req.cwd) || req.args.Any(a => a.Contains('\0'))) throw new ArgumentException("Absolute executable/cwd required");
            job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION(); limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE, no breakaway
            Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()));
            var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(), bInheritHandle = true };
            Check(CreatePipe(out outRead, out outWrite, ref sa, 0)); Check(SetHandleInformation(outRead, 1, 0));
            Check(CreatePipe(out errRead, out errWrite, ref sa, 0)); Check(SetHandleInformation(errRead, 1, 0));
            nul = CreateFile("NUL", 0x80000000, 3, ref sa, 3, 0, IntPtr.Zero); Check(nul != new IntPtr(-1));
            IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            attributes = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size));
            jobList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, job);
            // JOB_LIST assigns atomically during creation; no suspended-orphan window.
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(handles, 0, nul); Marshal.WriteIntPtr(handles, IntPtr.Size, outWrite); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, errWrite);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero));
            var si = new STARTUPINFOEX { StartupInfo = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFOEX>(), dwFlags = 0x100 | 1, wShowWindow = (short)(req.visible ? 1 : 0), hStdInput = nul, hStdOutput = outWrite, hStdError = errWrite }, lpAttributeList = attributes };
            var command = Quote(req.file) + (req.args.Length == 0 ? "" : " " + string.Join(" ", req.args.Select(a => req.windowsVerbatimArguments ? a : Quote(a))));
            var block = string.Join('\0', req.env.OrderBy(kv => kv.Key, StringComparer.OrdinalIgnoreCase).Select(kv => {
                if (kv.Key.Contains('=') || kv.Key.Contains('\0') || kv.Value.Contains('\0')) throw new ArgumentException("Invalid environment");
                return kv.Key + "=" + kv.Value;
            })) + "\0\0";
            environment = Marshal.StringToHGlobalUni(block);
            Check(CreateProcess(req.file, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, 0x80000 | 0x400 | (req.visible ? 0u : 0x08000000u), environment, req.cwd, ref si, out pi));
            created = true;
            Close(ref outWrite); Close(ref errWrite); Close(ref nul); Close(ref pi.hThread);
            Emit(new { kind = "started", pid = pi.dwProcessId, ownership = "WINDOWS_JOB" });
            var stdout = Pump(outRead, "stdout"); outRead = IntPtr.Zero;
            var stderr = Pump(errRead, "stderr"); errRead = IntPtr.Zero;
            // Private stdin is retained by Node. EOF/crash/STOP ends the whole job.
            _ = Task.Run(() => { while (true) { var control = Console.ReadLine(); if (control is null || control == "STOP") { TerminateJobObject(job, 1223); return; } } });
            bool rootReported = false; uint exitCode = 0;
            while (true)
            {
                Check(GetExitCodeProcess(pi.hProcess, out exitCode));
                if (exitCode != 259 && !rootReported) { rootReported = true; Emit(new { kind = "root-exit", exitCode }); }
                Check(QueryInformationJobObject(job, 1, out var accounting, Marshal.SizeOf<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>(), IntPtr.Zero));
                if (accounting.ActiveProcesses == 0) break;
                await Task.Delay(20);
            }
            await Task.WhenAll(stdout, stderr);
            Emit(new { kind = "exit", exitCode });
            return 0;
        }
        catch (Exception ex) { Emit(new { kind = "error", code = (ex as Win32Exception)?.NativeErrorCode, message = ex.Message }); return 1; }
        finally
        {
            if (created && job != IntPtr.Zero) TerminateJobObject(job, 1223);
            Close(ref job); Close(ref pi.hThread); Close(ref pi.hProcess); Close(ref outRead); Close(ref outWrite); Close(ref errRead); Close(ref errWrite); Close(ref nul);
            if (attributes != IntPtr.Zero) { DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
            foreach (var p in new[] { jobList, handles, environment }) if (p != IntPtr.Zero) Marshal.FreeHGlobal(p);
        }
    }
    private static async Task Pump(IntPtr handle, string stream)
    {
        using var pipe = new FileStream(new SafeFileHandle(handle, true), FileAccess.Read, 4096, false);
        var bytes = new byte[4096]; int n;
        while ((n = await pipe.ReadAsync(bytes)) > 0) Emit(new { kind = "output", stream, base64 = Convert.ToBase64String(bytes, 0, n) });
    }
    private static void Close(ref IntPtr h) { if (h != IntPtr.Zero && h != new IntPtr(-1)) CloseHandle(h); h = IntPtr.Zero; }
    // CRT argv quoting. cmd verbatim is separately prepared by TerminalService.
    private static string Quote(string value)
    {
        if (value.Length > 0 && !value.Any(ch => char.IsWhiteSpace(ch) || ch == '"')) return value;
        var b = new StringBuilder("\""); int slashes = 0;
        foreach (var ch in value) { if (ch == '\\') { slashes++; continue; } b.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes); b.Append(ch); slashes = 0; }
        b.Append('\\', slashes * 2); return b.Append('"').ToString();
    }
    [StructLayout(LayoutKind.Sequential)] private struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct STARTUPINFO { public int cb; public string? lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] private struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION { public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime; public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr sa, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int type, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int type, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, int size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES sa, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateFile(string name, uint access, uint share, ref SECURITY_ATTRIBUTES sa, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")] private static extern bool CreateProcess(string application, StringBuilder command, IntPtr psa, IntPtr tsa, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
}
