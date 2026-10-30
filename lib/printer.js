const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { printer } = require("../config");

const RAW_PRINT_SCRIPT = path.join(__dirname, "raw-print.ps1");

function getUsbQueueName(options = {}) {
  return options.usbQueueName || printer.usb?.queueName || "";
}

function isUsbFallbackEnabled(options = {}) {
  if (options.usbFallback !== undefined) {
    return Boolean(options.usbFallback);
  }

  return Boolean(printer.usb?.fallback);
}

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      reject(new Error("USB printing is only supported on Windows."));
      return;
    }

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args],
      { windowsHide: true }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function sendOverNetwork(zplData, options = {}) {
  const ip = options.ip || printer.ip;
  const port = Number(options.port || printer.port);
  const timeoutMs = Number(options.timeoutMs || printer.timeoutMs || 10000);

  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let settled = false;
    let connected = false;

    function finish(error, result) {
      if (settled) return;
      settled = true;
      client.destroy();
      if (error) {
        error.connected = connected;
        reject(error);
      } else resolve(result);
    }

    client.setTimeout(timeoutMs);

    client.connect(port, ip, () => {
      connected = true;
      client.write(zplData, () => {
        client.end();
      });
    });

    client.on("timeout", () => {
      finish(new Error(`Connection to ${ip}:${port} timed out after ${timeoutMs} ms.`));
    });

    client.on("error", (error) => {
      finish(error);
    });

    client.on("close", () => {
      finish(null, {
        transport: "network",
        ip,
        port,
        bytesSent: Buffer.byteLength(zplData, "utf8"),
      });
    });
  });
}

async function sendOverUsb(zplData, options = {}) {
  const queueName = getUsbQueueName(options);

  if (!queueName) {
    throw new Error("No USB printer queue is configured.");
  }

  const tempFile = path.join(
    os.tmpdir(),
    `label-printer-${Date.now()}-${Math.random().toString(16).slice(2)}.zpl`
  );

  await fs.promises.writeFile(tempFile, zplData, "latin1");

  try {
    const { code, stdout, stderr } = await runPowerShell([
      "-File",
      RAW_PRINT_SCRIPT,
      "-PrinterName",
      queueName,
      "-DataFile",
      tempFile,
    ]);

    if (code !== 0 || !stdout.startsWith("OK:")) {
      throw new Error(
        stdout || stderr || `USB print failed with exit code ${code}.`
      );
    }

    return {
      transport: "usb",
      queueName,
      bytesSent: Number(stdout.slice(3)) || Buffer.byteLength(zplData, "latin1"),
    };
  } finally {
    fs.promises.unlink(tempFile).catch(() => {});
  }
}

async function testUsbConnection(options = {}) {
  const queueName = getUsbQueueName(options);

  if (!queueName) {
    throw new Error("No USB printer queue is configured.");
  }

  const escapedName = queueName.replace(/'/g, "''");
  const { stdout } = await runPowerShell([
    "-Command",
    `$queue = Get-Printer -Name '${escapedName}' -ErrorAction SilentlyContinue; if ($queue) { 'FOUND ' + $queue.PortName } else { 'MISSING' }`,
  ]);

  if (!stdout.startsWith("FOUND")) {
    throw new Error(`USB printer queue "${queueName}" was not found on this PC.`);
  }

  return {
    ok: true,
    transport: "usb",
    queueName,
    portName: stdout.slice(6).trim(),
  };
}

async function sendToPrinter(zplData, options = {}) {
  if (!zplData || typeof zplData !== "string") {
    throw new Error("No ZPL data was provided.");
  }

  try {
    return await sendOverNetwork(zplData, options);
  } catch (networkError) {
    if (!isUsbFallbackEnabled(options) || networkError.connected) {
      throw networkError;
    }

    try {
      const result = await sendOverUsb(zplData, options);
      return { ...result, networkError: networkError.message };
    } catch (usbError) {
      throw new Error(
        `Network print failed (${networkError.message}) and USB fallback failed (${usbError.message}).`
      );
    }
  }
}

function testNetworkConnection(options = {}) {
  const ip = options.ip || printer.ip;
  const port = Number(options.port || printer.port);
  const timeoutMs = Number(options.timeoutMs || printer.timeoutMs || 10000);

  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let settled = false;

    function finish(error, result) {
      if (settled) return;
      settled = true;
      client.destroy();
      if (error) reject(error);
      else resolve(result);
    }

    client.setTimeout(timeoutMs);
    client.connect(port, ip, () => {
      finish(null, { ok: true, transport: "network", ip, port });
    });
    client.on("timeout", () => finish(new Error(`Connection to ${ip}:${port} timed out after ${timeoutMs} ms.`)));
    client.on("error", finish);
  });
}

async function testConnection(options = {}) {
  try {
    return await testNetworkConnection(options);
  } catch (networkError) {
    if (!isUsbFallbackEnabled(options)) {
      throw networkError;
    }

    try {
      const result = await testUsbConnection(options);
      return { ...result, networkError: networkError.message };
    } catch (usbError) {
      throw new Error(
        `Network connection failed (${networkError.message}) and USB fallback failed (${usbError.message}).`
      );
    }
  }
}

function buildFeedCommand(labelCount = 1) {
  const count = Math.max(1, Math.min(10, Number(labelCount) || 1));
  return `^XA^PQ${count}^XZ`;
}

function buildCalibrateCommand() {
  return "~JC";
}

module.exports = {
  sendToPrinter,
  testConnection,
  sendOverNetwork,
  sendOverUsb,
  testUsbConnection,
  buildFeedCommand,
  buildCalibrateCommand,
};
