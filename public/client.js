const socket = io();

const scanBtn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const deviceListEl = document.getElementById('device-list');

scanBtn.addEventListener('click', () => {
    scanBtn.disabled = true;
    statusEl.textContent = 'スキャン中... (約5秒)';
    deviceListEl.innerHTML = '';
    fetch('/scan', { method: 'POST' });
});

socket.on('device-found', (device) => {
    const li = document.createElement('li');
    const isAirConditioner = device.objects.some(obj => obj.startsWith('0130'));

    let innerContent = '';
    if (isAirConditioner) {
        li.className = 'air-conditioner';
        const acEoj = device.objects.find(obj => obj.startsWith('0130'));
        // リンクを作成
        innerContent = `<a href="/control.html?ip=${device.address}&eoj=${acEoj}">
            <strong>IP:</strong> ${device.address}<br>
            <strong>オブジェクト:</strong> <span class="object-code">エアコン (0x${acEoj})</span>
        </a>`;
    } else {
        const objectsHtml = device.objects.map(obj => `<span class="object-code">0x${obj}</span>`).join(', ');
        innerContent = `<strong>IP:</strong> ${device.address}<br><strong>オブジェクト:</strong> ${objectsHtml}`;
    }
    li.innerHTML = innerContent;
    deviceListEl.appendChild(li);
});

socket.on('scan-finished', (message) => {
    statusEl.textContent = message;
    scanBtn.disabled = false;
});