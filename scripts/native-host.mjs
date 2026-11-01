// scripts/native-host.ts
import { createBridgeServer } from "@chatgpt-bridge/local-sdk";
var stdoutWrite = process.stdout.write.bind(process.stdout);
function logStderr(...args) {
  const line = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ") + "\n";
  process.stderr.write(`[native-host] ${line}`);
}
console.log = logStderr;
console.info = logStderr;
console.warn = logStderr;
console.error = logStderr;
console.debug = logStderr;
process.on("uncaughtException", (err) => {
  logStderr("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  logStderr("Unhandled rejection:", reason);
});
function sendNativeMessage(msg) {
  try {
    const payload = Buffer.from(JSON.stringify(msg), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    stdoutWrite(header);
    stdoutWrite(payload);
  } catch (err) {
    logStderr("Failed to send native message:", err);
  }
}
var PORT = Number(process.env.PORT ?? 8787);
var bridgeServer = null;
var isShuttingDown = false;
async function startBridge() {
  if (bridgeServer) return;
  try {
    logStderr(`Starting bridge server on port ${PORT}...`);
    bridgeServer = createBridgeServer({
      port: PORT,
      logger: (level, msg) => {
        logStderr(`[bridge:${level}] ${msg}`);
      }
    });
    await bridgeServer.start();
    logStderr(`Bridge server running on http://127.0.0.1:${PORT}`);
    sendNativeMessage({
      type: "ready",
      port: PORT,
      status: "running"
    });
  } catch (err) {
    logStderr("Failed to start bridge server:", err?.message ?? err);
    sendNativeMessage({
      type: "error",
      port: PORT,
      error: err?.message ?? String(err)
    });
    if (!isShuttingDown) {
      setTimeout(() => {
        if (!bridgeServer && !isShuttingDown) {
          logStderr("Retrying bridge server start...");
          void startBridge();
        }
      }, 1500);
    }
  }
}
async function stopBridge() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logStderr("Stopping bridge server...");
  if (bridgeServer) {
    try {
      await bridgeServer.stop();
    } catch (err) {
      logStderr("Error stopping server:", err);
    }
  }
  process.exit(0);
}
async function handleNativeMessage(msg) {
  logStderr("Received message from Chrome:", msg);
  const action = msg?.action ?? msg?.type;
  switch (action) {
    case "ping":
      if (!bridgeServer && !isShuttingDown) {
        await startBridge();
      }
      sendNativeMessage({
        type: "pong",
        port: PORT,
        running: bridgeServer !== null,
        extensionConnected: bridgeServer?.bridge.isExtensionConnected() ?? false
      });
      break;
    case "status":
      sendNativeMessage({
        type: "status",
        port: PORT,
        running: bridgeServer !== null,
        extensionConnected: bridgeServer?.bridge.isExtensionConnected() ?? false,
        extensionInfo: bridgeServer?.bridge.getExtensionInfo() ?? null
      });
      break;
    case "stop":
      void stopBridge();
      break;
    default:
      logStderr("Unknown message action:", action);
      break;
  }
}
var inputBuffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
  inputBuffer = Buffer.concat([inputBuffer, buf]);
  while (inputBuffer.length >= 4) {
    const msgLen = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + msgLen) {
      break;
    }
    const msgBytes = inputBuffer.subarray(4, 4 + msgLen);
    inputBuffer = inputBuffer.subarray(4 + msgLen);
    try {
      const msg = JSON.parse(msgBytes.toString("utf8"));
      handleNativeMessage(msg);
    } catch (err) {
      logStderr("Error parsing native message JSON:", err);
    }
  }
});
process.stdin.on("end", () => {
  logStderr("Stdin closed by Chrome. Exiting.");
  void stopBridge();
});
process.stdin.on("close", () => {
  logStderr("Stdin stream closed. Exiting.");
  void stopBridge();
});
process.on("SIGINT", () => {
  logStderr("SIGINT received.");
  void stopBridge();
});
process.on("SIGTERM", () => {
  logStderr("SIGTERM received.");
  void stopBridge();
});
void startBridge();
