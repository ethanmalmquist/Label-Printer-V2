// scripts/generate-cert.js
//
// Generates a self-signed HTTPS certificate (via openssl, already on PATH
// through Git for Windows) covering localhost + every LAN IPv4 address this
// machine currently has, so a phone on the same Wi-Fi can load this app over
// HTTPS -- required for camera access (getUserMedia refuses insecure
// origins other than localhost).
//
// Re-run this any time your LAN IP changes (e.g. after a DHCP renewal) --
// it overwrites certs/ with a fresh cert covering the current address.
//
// Usage: node scripts/generate-cert.js

const os = require("os");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const CERTS_DIR = path.join(__dirname, "..", "certs");
const KEY_PATH = path.join(CERTS_DIR, "key.pem");
const CERT_PATH = path.join(CERTS_DIR, "cert.pem");
const DER_PATH = path.join(CERTS_DIR, "vision-cert.cer");
const CONFIG_PATH = path.join(CERTS_DIR, "openssl.cnf");

function getLanIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

function buildOpensslConfig(ipAddresses) {
  const altNames = [
    "DNS.1 = localhost",
    ...ipAddresses.map((ip, index) => `IP.${index + 1} = ${ip}`),
    `IP.${ipAddresses.length + 1} = 127.0.0.1`,
  ];

  return `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = Grabtech ERP Local Dev

[v3_req]
keyUsage = keyEncipherment, dataEncipherment, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${altNames.join("\n")}
`;
}

function main() {
  const ipAddresses = getLanIPv4Addresses();

  if (!ipAddresses.length) {
    console.warn("No non-internal IPv4 address found -- cert will only cover localhost/127.0.0.1.");
  } else {
    console.log(`LAN IPv4 address(es) found: ${ipAddresses.join(", ")}`);
  }

  fs.mkdirSync(CERTS_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, buildOpensslConfig(ipAddresses));

  console.log("Generating self-signed certificate (valid 825 days, matches Apple's max leaf-cert lifetime)...");
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-nodes",
      "-newkey", "rsa:2048",
      "-keyout", KEY_PATH,
      "-out", CERT_PATH,
      "-days", "825",
      "-config", CONFIG_PATH,
    ],
    { stdio: "inherit" }
  );

  console.log("Exporting DER copy for iPhone/Safari's certificate-install flow...");
  execFileSync("openssl", ["x509", "-in", CERT_PATH, "-outform", "der", "-out", DER_PATH], { stdio: "inherit" });

  console.log(`\nDone. Wrote:\n  ${KEY_PATH}\n  ${CERT_PATH}\n  ${DER_PATH}`);
  console.log("\nRestart the server (npm start) to pick up the new certificate.");
}

main();
