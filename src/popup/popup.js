document.getElementById('central').addEventListener('click', () => chrome.tabs.create({url: chrome.runtime.getURL('src/dashboard/dashboard.html')}));
document.getElementById('whatsapp').addEventListener('click', () => chrome.tabs.create({url: 'https://web.whatsapp.com/'}));
