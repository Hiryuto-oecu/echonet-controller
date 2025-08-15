const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dgram = require("dgram");
const path = require("path");
const os = require("os");

// ... (定数定義は変更なし)
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/control.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "control.html"));
});

const ECHONET_LITE_PORT = 3610;
const ECHONET_LITE_MULTICAST_ADDRESS = "224.0.23.0";
const ESV = {
  GET: 0x62,
  GET_RES: 0x72,
  SETC: 0x61,
  SET_RES: 0x71,
  SET_SNA: 0x51,
};
const SEOJ_CONTROLLER = [0x05, 0xff, 0x01];
const DEOJ_NODE_PROFILE = [0x0e, 0xf0, 0x01];
const EPC = {
  INSTANCE_LIST_S: 0xd6,
  POWER: 0x80,
  MODE: 0xb0,
  TEMP: 0xb3,
  FAN_SPEED: 0xa0,
  TEMP_ROOM: 0xbb,
  HUMIDITY: 0xba,
  TEMP_OUTDOOR: 0xbe,
  BUZZER: 0xd0,
  FAN_DIRECTION_UD: 0xa4,
  FAN_DIRECTION_LR: 0xa5,
};
const POWER_STATE = { ON: 0x30, OFF: 0x31 };
const MODE_MAP = {
  0x41: "自動",
  0x42: "冷房",
  0x43: "暖房",
  0x44: "除湿",
  0x45: "送風",
};
const SCAN_TIMEOUT = 5000;
const GET_TIMEOUT = 3000;

let elSocket;
let nextTid = 1;
const tidCallbacks = new Map();

// --- [デバッグ用] EPCコードを名前に変換するヘルパー ---
const EPC_MAP = Object.fromEntries(
  Object.entries(EPC).map(([key, value]) => [value, key])
);

function getEpcName(epc) {
  return EPC_MAP[epc] || `0x${epc.toString(16)}`;
}
// ---

// --- ユーティリティ関数 ---
function sendGetRequest(ip, eoj, properties) {
  return new Promise((resolve, reject) => {
    const tid = nextTid++;
    const packet = buildPacket(tid, eoj, ESV.GET, properties);

    // --- [デバッグログ] 送信内容を表示 ---
    const epcNames = properties.map((p) => getEpcName(p.epc)).join(", ");
    console.log(`[送信準備] TID:${tid}, IP:${ip}, EPC:[${epcNames}]`);
    // ---

    const timeoutId = setTimeout(() => {
      if (tidCallbacks.has(tid)) {
        tidCallbacks.delete(tid);
        // --- [デバッグログ] タイムアウトを記録 ---
        console.error(`[タイムアウト] TID:${tid}, IP:${ip}, EPC:[${epcNames}]`);
        // ---
        reject(new Error(`TID ${tid} for ${ip} timed out.`));
      }
    }, GET_TIMEOUT);

    tidCallbacks.set(tid, (parsed, rinfo) => {
      clearTimeout(timeoutId);
      tidCallbacks.delete(tid);

      // --- [デバッグログ] 受信内容を詳細に表示 ---
      const esvName =
        Object.keys(ESV).find((key) => ESV[key] === parsed.esv) ||
        `0x${parsed.esv.toString(16)}`;
      console.log(`[受信成功] TID:${tid}, IP:${ip}, ESV:${esvName}`);
      parsed.properties.forEach((p) => {
        console.log(
          `  -> EPC: ${getEpcName(p.epc)}, PDC: ${p.pdc}, EDT: ${p.edt.toString(
            "hex"
          )}`
        );
      });
      // ---

      if (parsed.esv === ESV.GET_RES) {
        resolve(parsed.properties);
      } else {
        // GET_RES以外の応答もエラーとして扱う（GET_SNAなど）
        reject(new Error(`Received non-GET_RES response: ${esvName}`));
      }
    });

    elSocket.send(packet, ECHONET_LITE_PORT, ip, (err) => {
      if (err) {
        clearTimeout(timeoutId);
        tidCallbacks.delete(tid);
        console.error(`[送信エラー] TID:${tid}, IP:${ip}`, err);
        reject(err);
      } else {
        console.log(`[送信完了] TID:${tid}, IP:${ip}`);
      }
    });
  });
}

// --- Socket.IOイベントリスナー ---
io.on("connection", (socket) => {
  console.log("クライアント接続:", socket.id);
  setupElSocket();

  socket.on("get-device-details", async ({ ip, eoj }) => {
    console.log(`\n--- [詳細取得シーケンス開始] IP: ${ip} ---`);

    const details = {
      ip: ip,
      power: null,
      mode: null,
      temp: null,
      fanSpeed: null,
      tempRoom: null,
      humidity: null,
      tempOutdoor: null,
      fanDirectionUD: null,
      fanDirectionLR: null,
    };

    try {
      console.log("--- [詳細取得] ステップ1：必須プロパティ取得開始 ---");
      const essentialProps = await sendGetRequest(ip, eoj, [
        { epc: EPC.POWER },
        { epc: EPC.MODE },
        { epc: EPC.TEMP },
        { epc: EPC.FAN_SPEED },
      ]);
      console.log(`[詳細取得] ステップ1：必須プロパティ取得成功`);

      essentialProps.forEach((prop) => {
        if (prop.pdc > 0) {
          if (prop.epc === EPC.POWER)
            details.power = prop.edt[0] === POWER_STATE.ON ? "ON" : "OFF";
          if (prop.epc === EPC.MODE)
            details.mode =
              MODE_MAP[prop.edt[0]] || `不明 (0x${prop.edt[0].toString(16)})`;
          if (prop.epc === EPC.TEMP) details.temp = prop.edt[0];
          if (prop.epc === EPC.FAN_SPEED) details.fanSpeed = prop.edt[0];
        }
      });

      socket.emit("device-details-update", details);
      console.log(
        "--- [詳細取得] ステップ1：フロントエンドへ中間結果を送信完了 ---"
      );

      console.log(
        "\n--- [詳細取得] ステップ2：オプションプロパティ取得開始 (並列処理) ---"
      );
      const optionalPropRequests = [
        sendGetRequest(ip, eoj, [{ epc: EPC.TEMP_ROOM }])
          .then((p) => {
            if (p[0].pdc > 0) details.tempRoom = p[0].edt.readInt8(0);
          })
          .catch((e) => console.error(`TEMP_ROOM取得失敗: ${e.message}`)),
        sendGetRequest(ip, eoj, [{ epc: EPC.HUMIDITY }])
          .then((p) => {
            if (p[0].pdc > 0) details.humidity = p[0].edt.readUInt8(0);
          })
          .catch((e) => console.error(`HUMIDITY取得失敗: ${e.message}`)),
        sendGetRequest(ip, eoj, [{ epc: EPC.TEMP_OUTDOOR }])
          .then((p) => {
            if (p[0].pdc > 0) details.tempOutdoor = p[0].edt.readInt8(0);
          })
          .catch((e) => console.error(`TEMP_OUTDOOR取得失敗: ${e.message}`)),
        sendGetRequest(ip, eoj, [{ epc: EPC.FAN_DIRECTION_UD }])
          .then((p) => {
            if (p[0].pdc > 0) details.fanDirectionUD = p[0].edt[0];
          })
          .catch((e) =>
            console.error(`FAN_DIRECTION_UD取得失敗: ${e.message}`)
          ),
        sendGetRequest(ip, eoj, [{ epc: EPC.FAN_DIRECTION_LR }])
          .then((p) => {
            if (p[0].pdc > 0) details.fanDirectionLR = p[0].edt[0];
          })
          .catch((e) =>
            console.error(`FAN_DIRECTION_LR取得失敗: ${e.message}`)
          ),
      ];

      await Promise.all(optionalPropRequests);
      console.log(
        "--- [詳細取得] ステップ2：全てのオプションプロパティ取得処理が完了 ---"
      );

      socket.emit("device-details-update", details);
      console.log(
        "--- [詳細取得] ステップ2：フロントエンドへ最終結果を送信完了 ---"
      );
    } catch (error) {
      console.error(`[詳細取得シーケンスエラー] IP: ${ip} - `, error.message);
      details.power = details.power || "取得失敗";
      socket.emit("device-details-update", details);
    }
  });

  socket.on("set-device-property", ({ ip, eoj, epc, edt }) => {
    const tid = nextTid++;
    const properties = [{ epc, edt }];
    const isPowerOff = epc === EPC.POWER && edt[0] === POWER_STATE.OFF;
    if (!isPowerOff) {
      properties.push({ epc: EPC.BUZZER, edt: [0x41] });
    }
    const packet = buildPacket(tid, eoj, ESV.SETC, properties);

    const timeoutId = setTimeout(() => {
      tidCallbacks.delete(tid);
      socket.emit("set-property-result", {
        success: false,
        message: "タイムアウト",
        ip,
      });
    }, GET_TIMEOUT);

    tidCallbacks.set(tid, (parsed, rinfo) => {
      clearTimeout(timeoutId);
      tidCallbacks.delete(tid); // SETの場合はここでコールバックを削除
      const originalProp = parsed.properties.find((p) => p.epc === epc);
      const success =
        (parsed.esv === ESV.SET_RES || parsed.esv === ESV.SET_SNA) &&
        originalProp &&
        originalProp.pdc === 0;
      const message = success ? "成功" : "端末からエラー応答";
      socket.emit("set-property-result", { success, message, ip });
    });
    elSocket.send(packet, ECHONET_LITE_PORT, ip, (err) => {
      if (err) {
        clearTimeout(timeoutId);
        tidCallbacks.delete(tid);
        socket.emit("set-property-result", {
          success: false,
          message: "送信エラー",
          ip,
        });
      }
    });
  });
});

// ... (以降の関数は変更なし)
server.listen(PORT, () =>
  console.log(`サーバーが http://localhost:${PORT} で起動しました`)
);
function setupElSocket() {
  if (elSocket && elSocket.address()) return;
  if (elSocket) {
    try {
      elSocket.close();
    } catch (e) {}
  }
  elSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  elSocket.on("message", (msg, rinfo) => {
    const parsed = parseEchonetLiteResponse(msg);
    if (parsed && tidCallbacks.has(parsed.tid)) {
      const callback = tidCallbacks.get(parsed.tid);
      callback(parsed, rinfo);
    }
  });
  elSocket.on("error", (err) => console.error("Socket Error:", err));
  elSocket.bind(ECHONET_LITE_PORT, () => {
    try {
      elSocket.addMembership(ECHONET_LITE_MULTICAST_ADDRESS);
    } catch (e) {
      console.error("マルチキャストエラー:", e);
    }
  });
}
app.post("/scan", (req, res) => {
  console.log("\n--- スキャンリクエスト受信 ---");
  const scannerSocket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const foundDevices = new Map();
  const scanTid = nextTid++;
  function getLocalInterfaceAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
    return "0.0.0.0";
  }
  const multicastInterfaceAddress = getLocalInterfaceAddress();
  scannerSocket.on("error", (err) => {
    console.error("!!! スキャンソケットでエラーが発生:", err);
    scannerSocket.close();
  });
  scannerSocket.on("message", (msg, rinfo) => {
    console.log(`[受信] IP: ${rinfo.address}, ポート: ${rinfo.port}`);
    if (foundDevices.has(rinfo.address)) {
      return;
    }
    const parsed = parseEchonetLiteResponse(msg);
    if (!parsed || parsed.tid !== scanTid || parsed.esv !== ESV.GET_RES) {
      return;
    }
    const prop = parsed.properties.find((p) => p.epc === EPC.INSTANCE_LIST_S);
    if (!prop || prop.edt.length === 0) {
      return;
    }
    const edt = prop.edt;
    const instanceCount = edt.readUInt8(0);
    const objects = [];
    for (let i = 0; i < instanceCount; i++) {
      const start = 1 + i * 3;
      if (start + 3 > edt.length) break;
      const eoj = [
        edt.readUInt8(start),
        edt.readUInt8(start + 1),
        edt.readUInt8(start + 2),
      ];
      objects.push(eoj.map((b) => b.toString(16).padStart(2, "0")).join(""));
    }
    console.log(
      `[発見] IP: ${rinfo.address}, オブジェクト: ${objects.join(", ")}`
    );
    const deviceInfo = { address: rinfo.address, objects };
    foundDevices.set(rinfo.address, deviceInfo);
    io.emit("device-found", deviceInfo);
  });
  scannerSocket.bind(ECHONET_LITE_PORT, multicastInterfaceAddress, () => {
    console.log(
      `スキャンソケットを ${multicastInterfaceAddress}:${ECHONET_LITE_PORT} にバインドしました`
    );
    try {
      scannerSocket.addMembership(ECHONET_LITE_MULTICAST_ADDRESS);
      scannerSocket.setMulticastInterface(multicastInterfaceAddress);
      console.log(
        `マルチキャストグループ ${ECHONET_LITE_MULTICAST_ADDRESS} に参加しました`
      );
      console.log(
        `  -> 送受信インターフェースとして ${multicastInterfaceAddress} を指定しました`
      );
    } catch (e) {
      console.error("!!! スキャンソケットのマルチキャスト設定エラー:", e);
    }
    const packet = buildPacket(scanTid, DEOJ_NODE_PROFILE, ESV.GET, [
      { epc: EPC.INSTANCE_LIST_S },
    ]);
    console.log(`探索パケットを送信します (TID: ${scanTid})`);
    scannerSocket.send(
      packet,
      ECHONET_LITE_PORT,
      ECHONET_LITE_MULTICAST_ADDRESS,
      (err) => {
        if (err) {
          console.error("!!! パケット送信エラー:", err);
        } else {
          console.log("探索パケットを送信完了");
        }
      }
    );
  });
  setTimeout(() => {
    console.log("--- スキャンタイムアウト ---");
    scannerSocket.close();
    io.emit("scan-finished", "スキャンが終了しました。");
  }, SCAN_TIMEOUT);
  res.json({ message: "スキャンを開始しました" });
});
function buildPacket(tid, deoj, esv, properties) {
  let pdcTotal = 0;
  properties.forEach((p) => {
    pdcTotal += 2 + (p.edt ? p.edt.length : 0);
  });
  const frame = Buffer.alloc(12 + pdcTotal);
  frame.writeUInt8(0x10, 0);
  frame.writeUInt8(0x81, 1);
  frame.writeUInt16BE(tid, 2);
  frame.set(SEOJ_CONTROLLER, 4);
  frame.set(deoj, 7);
  frame.writeUInt8(esv, 10);
  frame.writeUInt8(properties.length, 11);
  let offset = 12;
  properties.forEach((p) => {
    frame.writeUInt8(p.epc, offset);
    const edt = p.edt || [];
    frame.writeUInt8(edt.length, offset + 1);
    if (edt.length > 0) frame.set(edt, offset + 2);
    offset += 2 + edt.length;
  });
  return frame;
}
function parseEchonetLiteResponse(msg) {
  if (msg.length < 12) return null;
  const res = {
    tid: msg.readUInt16BE(2),
    esv: msg.readUInt8(10),
    properties: [],
  };
  const opc = msg.readUInt8(11);
  let offset = 12;
  for (let i = 0; i < opc; i++) {
    if (offset + 2 > msg.length) break;
    const epc = msg.readUInt8(offset);
    const pdc = msg.readUInt8(offset + 1);
    if (offset + 2 + pdc > msg.length) break;
    const edt = msg.slice(offset + 2, offset + 2 + pdc);
    res.properties.push({ epc, pdc, edt });
    offset += 2 + pdc;
  }
  return res;
}
