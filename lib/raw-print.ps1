param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$DataFile
)

$ErrorActionPreference = "Stop"

$source = @'
using System;
using System.Runtime.InteropServices;

public class ZebraRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static string SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter = IntPtr.Zero;

    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      return "ERROR: could not open printer queue (win32 " + Marshal.GetLastWin32Error() + ")";
    }

    DOCINFOW di = new DOCINFOW();
    di.pDocName = "Label Printer ZPL";
    di.pDataType = "RAW";

    if (!StartDocPrinter(hPrinter, 1, di)) {
      int err = Marshal.GetLastWin32Error();
      ClosePrinter(hPrinter);
      return "ERROR: StartDocPrinter failed (win32 " + err + ")";
    }

    if (!StartPagePrinter(hPrinter)) {
      int err = Marshal.GetLastWin32Error();
      EndDocPrinter(hPrinter);
      ClosePrinter(hPrinter);
      return "ERROR: StartPagePrinter failed (win32 " + err + ")";
    }

    IntPtr buffer = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, buffer, bytes.Length);

    int written = 0;
    bool ok = WritePrinter(hPrinter, buffer, bytes.Length, out written);
    int writeError = Marshal.GetLastWin32Error();

    Marshal.FreeCoTaskMem(buffer);
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);

    if (!ok) {
      return "ERROR: WritePrinter failed (win32 " + writeError + ")";
    }

    return "OK:" + written;
  }
}
'@

if (-not ("ZebraRawPrinter" -as [type])) {
  Add-Type -TypeDefinition $source -Language CSharp
}

if (-not (Test-Path -LiteralPath $DataFile)) {
  Write-Output "ERROR: ZPL data file not found"
  exit 1
}

$bytes = [System.IO.File]::ReadAllBytes($DataFile)
$result = [ZebraRawPrinter]::SendBytes($PrinterName, $bytes)

Write-Output $result

if ($result.StartsWith("OK:")) { exit 0 } else { exit 1 }
