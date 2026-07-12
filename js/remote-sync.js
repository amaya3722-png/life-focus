(function () {
  'use strict';
  var tokenKey = 'lifeFocusDeviceToken_v1';
  var queueKey = 'lifeFocusActionQueue_v1';
  var base = location.hostname === 'speech.huangjuntong.me'
    ? location.origin + '/life-focus-api'
    : (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'http://localhost:8010'
      : 'https://speech.huangjuntong.me/life-focus-api';

  function readQueue() { try { return JSON.parse(localStorage.getItem(queueKey) || '[]'); } catch (e) { return []; } }
  function saveQueue(items) { localStorage.setItem(queueKey, JSON.stringify(items)); updateButton(); }
  function token() { return localStorage.getItem(tokenKey) || ''; }
  function actionId(kind) { return 'web-' + kind + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10); }
  function request(path, options) {
    options = options || {};
    options.headers = Object.assign({'content-type': 'application/json'}, options.headers || {});
    if (options.authorized !== false && token()) options.headers.Authorization = 'Bearer ' + token();
    return fetch(base + path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status));
        return body;
      });
    });
  }
  function updateButton() {
    var button = document.getElementById('connectSyncBtn'); if (!button) return;
    var pending = readQueue().length;
    button.textContent = token() ? (pending ? '待同步 ' + pending : '已连接') : '连接同步';
    button.classList.toggle('connected', Boolean(token()));
  }
  function pair() {
    var code = prompt('请输入 6 位一次性配对码');
    if (!code) return Promise.resolve(false);
    return request('/pair', {method: 'POST', authorized: false, body: JSON.stringify({code: code.trim()})}).then(function (result) {
      if (!result.token) throw new Error('服务器未返回设备凭据');
      localStorage.setItem(tokenKey, result.token); updateButton();
      if (window.showNotification) showNotification('已连接，今后的勾选和排程会写入人生管理系统。');
      return flush().then(function () { return true; });
    }).catch(function (error) {
      if (window.showNotification) showNotification('连接失败：' + error.message);
      return false;
    });
  }
  function enqueue(kind, payload) {
    var items = readQueue();
    items.push({id: actionId(kind), kind: kind, payload: payload});
    saveQueue(items);
    if (!token()) {
      if (window.showNotification) showNotification('动作已保存在本机；连接同步后会自动写入。');
      return Promise.resolve({result: 'local_pending'});
    }
    return flush();
  }
  function flush() {
    if (!token()) return Promise.resolve({result: 'not_paired'});
    var items = readQueue();
    function next() {
      if (!items.length) { saveQueue(items); return Promise.resolve({result: 'synced'}); }
      var item = items[0];
      return request('/actions', {method: 'POST', body: JSON.stringify(item)}).then(function () {
        items.shift(); saveQueue(items); return next();
      });
    }
    return next().catch(function (error) {
      saveQueue(items);
      if (window.showNotification) showNotification('暂未同步，联网后会自动重试。');
      return {result: 'pending', error: error.message};
    });
  }
  function shanghaiTime() {
    return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
  }
  window.LifeFocusRemote = {enqueue: enqueue, flush: flush, pair: pair, hasToken: function () { return Boolean(token()); }, now: shanghaiTime};
  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('connectSyncBtn');
    if (button) button.addEventListener('click', function () { token() ? flush() : pair(); });
    updateButton(); flush();
  });
  addEventListener('online', flush);
  setInterval(flush, 60000);
})();
