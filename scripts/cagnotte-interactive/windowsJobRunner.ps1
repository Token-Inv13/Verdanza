param(
  [Parameter(Mandatory = $true)]
  [string]$Payload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class VerdanzaRecipeWindowsJob
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectBasicAccountingInformation = 1;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 258;
    private const uint INFINITE = 0xffffffff;
    private const uint DUPLICATE_SAME_ACCESS = 0x00000002;
    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint OPEN_EXISTING = 3;
    private const int ERROR_SUCCESS = 0;
    private const int SUPERVISOR_FAILURE_EXIT_CODE = 86;
    private const int JOB_TERMINATION_EXIT_CODE = 197;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information,
        uint informationLength,
        IntPtr returnLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(
        IntPtr sourceProcess,
        IntPtr sourceHandle,
        IntPtr targetProcess,
        out IntPtr targetHandle,
        uint desiredAccess,
        bool inheritHandle,
        uint options);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        ref SECURITY_ATTRIBUTES securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    public static int Run(string command, string[] arguments, string currentDirectory, bool simulateSetupFailure)
    {
        IntPtr job = IntPtr.Zero;
        IntPtr primaryProcess = IntPtr.Zero;
        IntPtr primaryThread = IntPtr.Zero;
        IntPtr standardInput = IntPtr.Zero;
        IntPtr standardOutput = IntPtr.Zero;
        IntPtr standardError = IntPtr.Zero;
        bool primaryResumed = false;
        try
        {
            if (simulateSetupFailure)
                throw new InvalidOperationException("simulated-job-setup-failure");

            job = CreateJobObject(IntPtr.Zero, null);
            EnsureHandle(job, "create-job");
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                ref limits,
                (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
                ThrowWin32("configure-job");

            standardInput = OpenInheritedNullInput();
            standardOutput = DuplicateInheritedStandardHandle(-11, "duplicate-stdout");
            standardError = DuplicateInheritedStandardHandle(-12, "duplicate-stderr");
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = standardInput;
            startup.hStdOutput = standardOutput;
            startup.hStdError = standardError;
            PROCESS_INFORMATION process;
            StringBuilder commandLine = BuildCommandLine(command, arguments);
            if (!CreateProcess(
                command,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                CREATE_SUSPENDED | CREATE_NO_WINDOW,
                IntPtr.Zero,
                currentDirectory,
                ref startup,
                out process))
                ThrowWin32("create-process");
            primaryProcess = process.hProcess;
            primaryThread = process.hThread;

            if (!AssignProcessToJobObject(job, primaryProcess))
                ThrowWin32("assign-process");
            Console.Out.WriteLine("VERDANZA_WINDOWS_JOB_READY primary=" + process.dwProcessId);
            Console.Out.Flush();
            if (ResumeThread(primaryThread) == UInt32.MaxValue)
                ThrowWin32("resume-process");
            primaryResumed = true;
            CloseOwnedHandle(ref primaryThread);

            ManualResetEvent stopRequested = new ManualResetEvent(false);
            Thread control = new Thread(delegate()
            {
                try
                {
                    string line;
                    while ((line = Console.In.ReadLine()) != null)
                    {
                        if (String.Equals(line, "STOP", StringComparison.Ordinal))
                        {
                            stopRequested.Set();
                            return;
                        }
                    }
                    stopRequested.Set();
                }
                catch
                {
                    stopRequested.Set();
                }
            });
            control.IsBackground = true;
            control.Start();

            bool primaryExited = false;
            while (!stopRequested.WaitOne(0))
            {
                uint wait = WaitForSingleObject(primaryProcess, 25);
                if (wait == WAIT_OBJECT_0)
                {
                    primaryExited = true;
                    break;
                }
                if (wait != WAIT_TIMEOUT)
                    ThrowWin32("wait-primary");
            }

            uint primaryExitCode = 0;
            if (primaryExited && !GetExitCodeProcess(primaryProcess, out primaryExitCode))
                ThrowWin32("read-primary-exit");
            string reason = primaryExited ? "primary-exit" : "stop-request";
            CloseOwnedHandle(ref primaryProcess);
            if (!TerminateJobObject(job, JOB_TERMINATION_EXIT_CODE))
                ThrowWin32("terminate-job");
            WaitForEmptyJob(job, 5000);
            Console.Out.WriteLine("VERDANZA_WINDOWS_JOB_TREE_STOPPED reason=" + reason);
            Console.Out.Flush();
            if (!primaryExited) return 0;
            return primaryExitCode > Int32.MaxValue ? SUPERVISOR_FAILURE_EXIT_CODE : (int)primaryExitCode;
        }
        catch (Exception error)
        {
            if (primaryProcess != IntPtr.Zero)
            {
                try { TerminateProcess(primaryProcess, SUPERVISOR_FAILURE_EXIT_CODE); }
                catch { }
            }
            Console.Error.WriteLine("VERDANZA_WINDOWS_JOB_ERROR " + SafeStage(error));
            Console.Error.Flush();
            return SUPERVISOR_FAILURE_EXIT_CODE;
        }
        finally
        {
            if (!primaryResumed && primaryProcess != IntPtr.Zero)
            {
                try { TerminateProcess(primaryProcess, SUPERVISOR_FAILURE_EXIT_CODE); }
                catch { }
            }
            CloseOwnedHandle(ref primaryThread);
            CloseOwnedHandle(ref primaryProcess);
            CloseOwnedHandle(ref standardInput);
            CloseOwnedHandle(ref standardOutput);
            CloseOwnedHandle(ref standardError);
            CloseOwnedHandle(ref job);
        }
    }

    private static void WaitForEmptyJob(IntPtr job, int timeoutMilliseconds)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMilliseconds);
        while (DateTime.UtcNow < deadline)
        {
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
            if (!QueryInformationJobObject(
                job,
                JobObjectBasicAccountingInformation,
                ref accounting,
                (uint)Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)),
                IntPtr.Zero))
                ThrowWin32("query-job");
            if (accounting.ActiveProcesses == 0) return;
            Thread.Sleep(10);
        }
        throw new TimeoutException("job-empty-timeout");
    }

    private static IntPtr OpenInheritedNullInput()
    {
        SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
        attributes.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        attributes.bInheritHandle = true;
        IntPtr handle = CreateFile(
            "NUL",
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ref attributes,
            OPEN_EXISTING,
            0,
            IntPtr.Zero);
        EnsureHandle(handle, "open-null-input");
        return handle;
    }

    private static IntPtr DuplicateInheritedStandardHandle(int standardHandle, string stage)
    {
        IntPtr current = GetCurrentProcess();
        IntPtr source = GetStdHandle(standardHandle);
        EnsureHandle(source, stage);
        IntPtr duplicate;
        if (!DuplicateHandle(current, source, current, out duplicate, 0, true, DUPLICATE_SAME_ACCESS))
            ThrowWin32(stage);
        return duplicate;
    }

    private static StringBuilder BuildCommandLine(string command, string[] arguments)
    {
        StringBuilder result = new StringBuilder(QuoteArgument(command));
        foreach (string argument in arguments ?? new string[0])
        {
            result.Append(' ');
            result.Append(QuoteArgument(argument ?? String.Empty));
        }
        return result;
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            return value;
        StringBuilder result = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static string SafeStage(Exception error)
    {
        Win32Exception native = error as Win32Exception;
        if (native != null) return "stage=" + native.Message + " code=" + native.NativeErrorCode;
        return "stage=" + error.Message + " code=" + ERROR_SUCCESS;
    }

    private static void EnsureHandle(IntPtr handle, string stage)
    {
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) ThrowWin32(stage);
    }

    private static void ThrowWin32(string stage)
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), stage);
    }

    private static void CloseOwnedHandle(ref IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return;
        CloseHandle(handle);
        handle = IntPtr.Zero;
    }
}
'@

try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "Windows Job Object runner invoked outside Windows."
  }
  Add-Type -TypeDefinition $source -Language CSharp
  $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
  $arguments = [string[]]@($decoded.arguments | ForEach-Object { [string]$_ })
  $simulateSetupFailure = $false
  if ($null -ne $decoded.simulateSetupFailure) {
    $simulateSetupFailure = [bool]$decoded.simulateSetupFailure
  }
  $exitCode = [VerdanzaRecipeWindowsJob]::Run(
    [string]$decoded.command,
    $arguments,
    [string]$decoded.currentDirectory,
    $simulateSetupFailure
  )
  exit $exitCode
} catch {
  [Console]::Error.WriteLine("VERDANZA_WINDOWS_JOB_ERROR stage=bootstrap code=86")
  exit 86
}
