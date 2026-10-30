module.exports = {
  printer: {
    ip: process.env.PRINTER_IP || "192.168.1.250",
    port: Number(process.env.PRINTER_PORT || 9100),
    timeoutMs: Number(process.env.PRINTER_TIMEOUT_MS || 10000),
    usb: {
      fallback: process.env.PRINTER_USB_FALLBACK !== "false",
      queueName: process.env.PRINTER_USB_QUEUE || "ZDesigner ZD421-203dpi ZPL",
    },
  },
};
