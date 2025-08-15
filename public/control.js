const socket = io();

const urlParams = new URLSearchParams(window.location.search);
const deviceIp = urlParams.get('ip');
const deviceEojHex = urlParams.get('eoj');

const deviceIpTitleEl = document.getElementById('device-ip-title');
const controlStatusEl = document.getElementById('control-status');
const controlPanels = document.querySelectorAll('.control-panel');
const tempInput = document.getElementById('temp-input');
const setTempBtn = document.getElementById('set-temp-btn');

// --- 操作パネルの要素を取得 ---
const fanDirectionUdPanel = document.querySelector('.fan-direction-ud-controls');
const fanDirectionLrPanel = document.querySelector('.fan-direction-lr-controls');

// ECHONET Liteのコードと表示名のマッピング
const FAN_DIRECTION_UD_MAP = { 0x41: '上', 0x44: '上中', 0x43: '中央', 0x45: '下中', 0x42: '下' };
const FAN_DIRECTION_LR_MAP = { 0x42: '左', 0x43: '中央', 0x41: '右', 0x44: '左右' };

// ヘルパー関数: コードを日本語に変換
function formatValue(value, map) {
    if (value === null || value === undefined) return '取得不可';
    return map[value] || `不明 (0x${value.toString(16)})`;
}
function formatFanSpeed(value) {
    if (value === null || value === undefined) return '取得不可';
    if (value === 0x41) return '自動';
    if (value >= 0x31 && value <= 0x38) {
        return `レベル${value - 0x30}`;
    }
    return `不明 (0x${value.toString(16)})`;
}

if (!deviceIp || !deviceEojHex) {
    deviceIpTitleEl.textContent = 'エラー: 対象デバイスが指定されていません';
} else {
    deviceIpTitleEl.textContent = `エアコン操作 (${deviceIp})`;
    
    const deviceEoj = [
        parseInt(deviceEojHex.substring(0, 2), 16),
        parseInt(deviceEojHex.substring(2, 4), 16),
        parseInt(deviceEojHex.substring(4, 6), 16)
    ];

    document.addEventListener('DOMContentLoaded', () => {
        socket.emit('get-device-details', { ip: deviceIp, eoj: deviceEoj });
    });

    controlPanels.forEach(panel => {
        panel.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' && e.target.id !== 'set-temp-btn') {
                const epc = parseInt(e.target.dataset.epc, 16);
                const edt = parseInt(e.target.dataset.edt, 16);
                
                controlStatusEl.textContent = '設定変更中...';
                socket.emit('set-device-property', {
                    ip: deviceIp,
                    eoj: deviceEoj,
                    epc: epc,
                    edt: [edt]
                });
            }
        });
    });

    setTempBtn.addEventListener('click', () => {
        const newTemp = parseInt(tempInput.value, 10);
        if (!isNaN(newTemp) && newTemp >= 16 && newTemp <= 30) {
            controlStatusEl.textContent = '温度設定中...';
            socket.emit('set-device-property', {
                ip: deviceIp,
                eoj: deviceEoj,
                epc: 0xB3,
                edt: [newTemp]
            });
        } else {
            alert('16から30の間の数値を入力してください。');
        }
    });

    socket.on('device-details-update', (details) => {
        if (details.ip !== deviceIp) return;

        // --- 基本情報の表示 ---
        document.getElementById('detail-power').textContent = details.power || '取得不可';
        document.getElementById('detail-mode').textContent = details.mode || '取得不可';
        document.getElementById('detail-fan-speed').textContent = formatFanSpeed(details.fanSpeed);
        
        // --- 温度関連の表示 ---
        if (details.temp !== null) {
            document.getElementById('detail-temp').textContent = `${details.temp}°C`;
            tempInput.value = details.temp;
        } else {
            document.getElementById('detail-temp').textContent = '取得不可';
        }
        document.getElementById('detail-temp-room').textContent = details.tempRoom !== null ? `${details.tempRoom}°C` : '取得不可';
        document.getElementById('detail-temp-outdoor').textContent = details.tempOutdoor !== null ? `${details.tempOutdoor}°C` : '取得不可';
        document.getElementById('detail-humidity').textContent = details.humidity !== null ? `${details.humidity}%` : '取得不可';

        // --- 風向情報の表示と、操作パネルの表示/非表示切り替え ---
        const fanUdEl = document.getElementById('detail-fan-direction-ud');
        const fanLrEl = document.getElementById('detail-fan-direction-lr');

        if (details.fanDirectionUD !== null) {
            fanUdEl.textContent = formatValue(details.fanDirectionUD, FAN_DIRECTION_UD_MAP);
            fanDirectionUdPanel.style.display = 'block'; // パネルを表示
        } else {
            fanUdEl.textContent = '対応していません';
            fanDirectionUdPanel.style.display = 'none'; // パネルを非表示
        }

        if (details.fanDirectionLR !== null) {
            fanLrEl.textContent = formatValue(details.fanDirectionLR, FAN_DIRECTION_LR_MAP);
            fanDirectionLrPanel.style.display = 'block'; // パネルを表示
        } else {
            fanLrEl.textContent = '対応していません';
            fanDirectionLrPanel.style.display = 'none'; // パネルを非表示
        }
    });

    socket.on('set-property-result', (result) => {
        if (result.ip !== deviceIp) return;

        controlStatusEl.textContent = result.success ? `設定に成功しました。` : `設定に失敗しました: ${result.message}`;
        if (result.success) {
            setTimeout(() => {
                socket.emit('get-device-details', { ip: deviceIp, eoj: deviceEoj });
                controlStatusEl.textContent = '';
            }, 1000);
        }
    });
}