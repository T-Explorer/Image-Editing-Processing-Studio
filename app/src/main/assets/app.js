/* AI 照相馆 Android 主逻辑：表单、原生桥调用、批量处理 */
(function () {
  'use strict';

  var SCHEMA = window.APP_SCHEMA || { ops: {}, labels: {} };
  var OPS = Object.keys(SCHEMA.ops);
  var state = {};
  var currentOp = OPS[0] || 'idphoto';

  function native(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      var raw = window.Android[method].apply(window.Android, args);
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return { ok: false, error: method + ': ' + e.message };
    }
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 表单 ----------
  function fieldNode(op, f) {
    var wrap = el('div', { 'class': 'field' + (['textarea', 'file', 'dir'].indexOf(f.type) >= 0 ? ' wide' : '') });
    if (f.type === 'bool_true' || f.type === 'boolopt') {
      var box = el('input', { type: 'checkbox' });
      box.checked = !!f.default;
      box.dataset.key = f.key;
      box.dataset.type = f.type;
      return el('label', { 'class': 'check' }, [box, document.createTextNode(f.label)]);
    }
    wrap.appendChild(el('label', { text: f.label }));
    var input;
    if (f.type === 'select') {
      input = el('select', {});
      f.options.forEach(function (opt) {
        input.appendChild(el('option', { value: opt, text: opt === '' ? '— 不指定 —' : opt }));
      });
      input.value = f.default || '';
    } else if (f.type === 'textarea') {
      input = el('textarea', { placeholder: f.help || '' });
      input.value = f.default || '';
    } else if (f.type === 'file') {
      input = el('button', { 'class': 'btn ghost small', type: 'button', text: '📷 选择图片 / 拍照' });
      input.onclick = function () { state[op][f.key] = null; native('pickImage'); };
    } else if (f.type === 'dir') {
      input = el('button', { 'class': 'btn ghost small', type: 'button', text: '📁 选择文件夹' });
      input.onclick = function () { native('pickFolder'); };
    } else {
      input = el('input', { type: f.type === 'number' ? 'number' : 'text', placeholder: f.help || '' });
      input.value = f.default != null ? f.default : '';
    }
    input.dataset.key = f.key;
    input.dataset.type = f.type;
    wrap.appendChild(input);
    if (f.type === 'file') {
      var preview = el('img', { 'class': 'picked', alt: '预览' });
      preview.id = 'preview_' + op + '_' + f.key;
      wrap.appendChild(preview);
    }
    if (f.type === 'dir') {
      var lab = el('div', { 'class': 'hint', id: 'folder_' + op + '_' + f.key, text: '未选择文件夹' });
      wrap.appendChild(lab);
    }
    if (f.help && f.type !== 'textarea' && f.type !== 'file' && f.type !== 'dir') {
      wrap.appendChild(el('div', { 'class': 'hint', text: f.help }));
    }
    return wrap;
  }

  function buildForm(op) {
    var def = SCHEMA.ops[op];
    var box = el('div', { 'class': 'card' });
    box.appendChild(el('h2', { text: def.label }));
    var grid = el('div', { 'class': 'grid' });
    def.fields.forEach(function (f) {
      if (f.type === 'file' && op === 'batch') return;
      grid.appendChild(fieldNode(op, f));
    });
    box.appendChild(grid);
    if (op === 'batch') {
      box.appendChild(el('div', { 'class': 'hint', text: '批量处理会读取所选文件夹中的图片（需系统授权），结果自动保存到「下载/AIPhotoStudio」' }));
    }
    var btn = el('button', { 'class': 'btn', type: 'button', text: '开始处理' });
    btn.onclick = function () { run(op); };
    box.appendChild(btn);
    box.appendChild(el('div', { 'class': 'hint', text: '提示：勾选「只预览提示词」可免费查看 AI 将如何处理。' }));
    box.appendChild(el('div', { id: 'result_' + op }));
    return box;
  }

  function collect(op) {
    var values = {};
    document.querySelectorAll('#form-' + op + ' [data-key]').forEach(function (node) {
      var k = node.dataset.key, t = node.dataset.type;
      if (t === 'bool_true' || t === 'boolopt') values[k] = node.checked;
      else if (t === 'file') { if (state[op] && state[op][k]) values[k] = state[op][k]; }
      else values[k] = node.value;
    });
    return values;
  }

  // ---------- 原生回调 ----------
  window.onImagePicked = function (json) {
    var r = typeof json === 'string' ? JSON.parse(json) : json;
    if (!r.ok) { alert('选择图片失败：' + r.error); return; }
    // 找到当前正在等待的图片字段
    var key;
    if (currentOp === 'generate') {
      key = 'reference';
    } else {
      var f = SCHEMA.ops[currentOp].fields.filter(function (x) { return x.type === 'file'; })[0];
      key = f ? f.key : 'image';
    }
    state[currentOp] = state[currentOp] || {};
    state[currentOp][key] = r;
    var pv = document.getElementById('preview_' + currentOp + '_' + key);
    if (pv) { pv.src = r.dataUri; pv.style.display = 'block'; }
  };

  window.onFolderPicked = function (json) {
    var r = typeof json === 'string' ? JSON.parse(json) : json;
    if (!r.ok) { alert('选择文件夹失败：' + r.error); return; }
    state[currentOp] = state[currentOp] || {};
    state[currentOp].folderUri = r.uri;
    var lab = document.getElementById('folder_' + currentOp + '_input_dir');
    if (lab) lab.textContent = r.uri;
  };

  // ---------- 执行 ----------
  function resultBox(op) { return document.getElementById('result_' + op); }

  function showPrompt(op, prompt) {
    resultBox(op).innerHTML = '<div class="card" style="background:#faf9ff"><h2>本次提示词</h2><div style="white-space:pre-wrap">' + esc(prompt) + '</div></div>';
  }

  function showImages(op, items, extraHtml) {
    var html = '<div class="msg ok">✅ 处理完成</div>';
    if (extraHtml) html += extraHtml;
    if (items.length) {
      html += '<div class="card"><h2>生成结果（点击保存到相册）</h2><div class="imgs">';
      items.forEach(function (it, i) {
        html += '<div class="item"><img src="' + it.url + '" alt="结果">' +
          '<div class="cap">' + esc(it.label) + '</div>' +
          '<button class="btn ghost small" style="width:calc(100% - 12px);margin:0 6px 6px" onclick="saveResult(\'' + i + '\')">保存到相册</button></div>';
      });
      html += '</div></div>';
    }
    html += '<details><summary>调试信息</summary><pre>' + esc(JSON.stringify({ count: items.length }, null, 2)) + '</pre></details>';
    resultBox(op).innerHTML = html;
    window._lastResults = items;
  }

  window.saveResult = function (i) {
    var item = (window._lastResults || [])[i];
    if (!item) return;
    var r = native('saveImage', item.url, item.name);
    alert(r.ok ? ('已保存到：' + r.path) : ('保存失败：' + r.error));
  };

  function apiCall(prompt, size, ratio, images) {
    var payload = { prompt: prompt, size: size || '2K' };
    if (ratio) payload.ratio = ratio;
    if (images && images.length) payload.images = images;
    return native('callApi', JSON.stringify(payload));
  }

  function dataUrl(b64) { return 'data:image/png;base64,' + b64; }

  function generateOnce(op, v, image) {
    var built = window.Prompts.build(op, v);
    var prompt = built.prompt;
    if (v.dry_run) {
      return Promise.resolve({ dry: true, prompt: prompt, spec: built.spec });
    }
    var ratio;
    if (op === 'idphoto' && built.spec) ratio = window.Prompts.closestRatio(built.spec.px[0], built.spec.px[1]);
    else if (op === 'outpaint' || op === 'generate') ratio = v.ratio;
    else if (image) ratio = window.Prompts.closestRatio(image.width, image.height);
    var images = image ? [image.dataUri] : (v.reference ? [v.reference.dataUri] : null);

    return new Promise(function (resolve) {
      var r = apiCall(prompt, v.size, ratio, images);
      if (!r.ok) return resolve({ error: r.error });
      var src = dataUrl(r.data);
      var chain;
      if (op === 'idphoto' && built.spec) {
        chain = window.ImgTools.fitToCanvas(src, built.spec.px[0], built.spec.px[1]).then(function (single) {
          var items = [{ url: single, name: '证件照_' + built.spec.label + '.png', label: '证件照 ' + built.spec.px.join('×') }];
          var sheetN = parseInt(v.sheet || 0);
          if (v.sheet !== '' && v.sheet != null) {
            return window.ImgTools.makeSheet(single, built.spec.px[0], built.spec.px[1], sheetN)
              .then(function (sheet) {
                items.push({ url: sheet, name: '6寸排版.png', label: '6 寸排版' });
                return { items: items, prompt: prompt };
              });
          }
          return { items: items, prompt: prompt };
        });
      } else if (['background', 'retouch', 'style', 'restore'].indexOf(op) >= 0 && image) {
        chain = window.ImgTools.fitToCanvas(src, image.width, image.height).then(function (out) {
          return { items: [{ url: out, name: op + '_' + Date.now() + '.png', label: '结果图' }], prompt: prompt };
        });
      } else {
        chain = Promise.resolve({ items: [{ url: src, name: op + '_' + Date.now() + '.png', label: op === 'generate' ? '文生图' : '扩图' }], prompt: prompt });
      }
      chain.then(resolve).catch(function (e) { resolve({ error: e.message }); });
    });
  }

  function run(op) {
    var box = resultBox(op);
    var v = collect(op);
    if (op !== 'generate' && op !== 'batch' && !state[op].image) {
      box.innerHTML = '<div class="msg err">请先选择图片。</div>';
      return;
    }
    if (op === 'batch') return runBatch(op, v);

    if (op === 'generate' && !v.prompt) {
      box.innerHTML = '<div class="msg err">请填写画面描述。</div>';
      return;
    }
    box.innerHTML = '<div class="msg">处理中… 图像生成通常需要几十秒，请保持页面打开。</div>';
    var image = state[op].image;
    generateOnce(op, v, image).then(function (res) {
      if (res.dry) { showPrompt(op, res.prompt); return; }
      if (res.error) { box.innerHTML = '<div class="msg err">❌ ' + esc(res.error) + '</div>'; return; }
      showImages(op, res.items);
    });
  }

  function batchValues(op, v) {
    var map = { background: 'bg_', retouch: 'rt_', style: 'st_', restore: 'rs_' };
    var prefix = map[v.batch_op] || 'bg_';
    var out = { extra: v.extra || '', size: v.size || '2K', dry_run: false };
    SCHEMA.ops.batch.fields.forEach(function (f) {
      if (f.key.indexOf(prefix) === 0) {
        out[f.key.substring(prefix.length)] = v[f.key];
      }
    });
    return out;
  }

  function runBatch(op, v) {
    var box = resultBox(op);
    var folder = state[op].folderUri;
    if (!folder) { box.innerHTML = '<div class="msg err">请先选择文件夹。</div>'; return; }
    if (v.dry_run) {
      var list = native('listImages', folder);
      if (!list.ok) { box.innerHTML = '<div class="msg err">' + esc(list.error) + '</div>'; return; }
      box.innerHTML = '<div class="msg ok">找到 ' + list.files.length + ' 张图片。' +
        '操作：' + esc(v.batch_op) + '。取消「只预览提示词」并点开始处理即可执行。</div>';
      return;
    }
    var listed = native('listImages', folder);
    if (!listed.ok) { box.innerHTML = '<div class="msg err">' + esc(listed.error) + '</div>'; return; }
    var files = listed.files.slice(0, parseInt(v.limit) > 0 ? parseInt(v.limit) : listed.files.length);
    var bv = batchValues(op, v);
    var done = 0, ok = 0;
    box.innerHTML = '<div class="msg">批量处理中：0 / ' + files.length + ' …</div>';

    function next(i) {
      if (i >= files.length) {
        showImages(op, [], '<div class="msg ok">批量完成：成功 ' + ok + ' / ' + files.length + '</div>');
        return;
      }
      var file = files[i];
      var read = native('readImage', file.uri);
      if (!read.ok) { box.innerHTML = '<div class="msg err">读取失败：' + esc(file.name) + ' - ' + esc(read.error) + '</div>'; return next(i + 1); }
      var image = { dataUri: read.dataUri, width: read.width, height: read.height, name: read.name };
      bv.dry_run = false;
      generateOnce(v.batch_op, bv, image).then(function (res) {
        if (!res.error && res.items && res.items[0]) {
          var name = read.name.replace(/\.[^.]+$/, '') + '_AI.png';
          var saved = native('saveImage', res.items[0].url, name);
          if (saved.ok) ok++;
        }
        done++;
        box.innerHTML = '<div class="msg">批量处理中：' + done + ' / ' + files.length + ' …</div>';
        next(i + 1);
      });
    }
    next(0);
  }

  // ---------- 设置 ----------
  function openSettings() {
    document.getElementById('settingsPanel').style.display = 'block';
    var cfg = native('getConfig');
    var fields = [
      ['api_key', 'API Key（已配置时留空表示不变）', 'password'],
      ['base_url', 'Base URL', 'text'],
      ['model', '模型名', 'text'],
      ['timeout', '超时（秒）', 'number'],
      ['max_upload_mb', '上传上限 MB', 'number'],
      ['max_long_edge', '长边上限 px', 'number'],
      ['size', '默认档位 1K/2K/3K/4K', 'text']
    ];
    var form = document.getElementById('settingsForm');
    form.innerHTML = '';
    fields.forEach(function (f) {
      var wrap = el('div', { 'class': 'field' });
      wrap.appendChild(el('label', { text: f[1] }));
      var input = el('input', { type: f[2], id: 'cfg_' + f[0] });
      input.value = cfg[f[0]] || '';
      if (f[0] === 'api_key' && cfg.api_key) input.placeholder = '当前：' + cfg.api_key;
      wrap.appendChild(input);
      form.appendChild(wrap);
    });
  }
  window.openSettings = openSettings;

  function closeSettings() { document.getElementById('settingsPanel').style.display = 'none'; }
  window.closeSettings = closeSettings;

  function saveSettings() {
    var data = {};
    ['api_key', 'base_url', 'model', 'timeout', 'max_upload_mb', 'max_long_edge', 'size'].forEach(function (k) {
      data[k] = (document.getElementById('cfg_' + k).value || '').trim();
    });
    var r = native('saveConfig', JSON.stringify(data));
    document.getElementById('settingsMsg').innerHTML = '<div class="msg ' + (r.ok ? 'ok' : 'err') + '">' +
      (r.ok ? '✅ 已保存' : '❌ ' + esc(r.error)) + '</div>';
  }
  window.saveSettings = saveSettings;

  function testConnection() {
    document.getElementById('settingsMsg').innerHTML = '<div class="msg">测试中…</div>';
    var r = native('testConnection');
    document.getElementById('settingsMsg').innerHTML = '<div class="msg ' + (r.ok ? 'ok' : 'err') + '">' +
      (r.ok ? '✅ ' : '❌ ') + esc(r.message || r.error || '') + '</div>';
  }
  window.testConnection = testConnection;

  // ---------- 初始化 ----------
  function init() {
    var tabs = document.getElementById('tabs');
    var main = document.getElementById('main');
    OPS.forEach(function (op, i) {
      state[op] = {};
      var tab = el('div', { 'class': 'tab' + (i === 0 ? ' active' : ''), text: SCHEMA.labels[op] || op });
      tab.id = 'tab_' + op;
      tab.onclick = function () {
        currentOp = op;
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab_' + op); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'form-' + op); });
      };
      tabs.appendChild(tab);
      var panel = el('section', { 'class': 'panel' + (i === 0 ? ' active' : ''), id: 'form-' + op });
      panel.appendChild(buildForm(op));
      main.appendChild(panel);
    });
  }

  init();
})();
