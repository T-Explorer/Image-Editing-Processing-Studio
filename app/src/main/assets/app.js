/* AI 照相馆 Android 主逻辑 v3.0
 * 每个功能独立分组布局 / 异步不卡顿 / 实时进度 / 单窗口精修预览
 * 一键规范描述 / 历史记录 / 大图预览 / 批量动态参数 / 透明抠图 / 本地无损放大
 */
(function () {
  'use strict';

  var SCHEMA = window.APP_SCHEMA || { ops: {}, labels: {}, icons: {}, tags: {} };
  var state = {};
  var currentOp = 'idphoto';
  var currentGroup = 'main';
  var PANELS = {};
  var BUILT = {};
  var pendingPick = null;
  var pendingFolder = null;
  var THEME_KEY = 'theme_mode';
  var APP_CFG = { auto_save: 'true' };
  var apiSeq = 0, _apiMeta = {}, _apiPending = {};
  var enhanceSeq = 0, _enhancePending = {};
  var listSeq = 0, _listPending = {};
  var saveSeq = 0, _savePending = {};
  var testSeq = 0, _testPending = {};
  var readSeq = 0, _readPending = {};
  var _lastResults = [];
  var _lbList = [], _lbIndex = 0;
  var batchStop = false;
  var retouchTimer = null;

  // ---------- 基础工具 ----------
  function qa(sel, fn, root) {
    var r = root || document, nodes = r.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }
  function native(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      var raw = window.Android[method].apply(window.Android, args);
      if (raw === undefined || raw === null) return { ok: true };
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
      if (v === undefined || v === null) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
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
  function toast(msg, type) {
    var host = document.getElementById('toastHost');
    if (!host) { try { native('toast', msg); } catch (e) {} return; }
    var t = el('div', { class: 'toast ' + (type || 'info'), text: msg });
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  function showError(msg) {
    try {
      var host = document.getElementById('errorHost');
      if (!host) return;
      host.innerHTML = '<div class="error-card"><b>⚠️ 操作出错</b><div>' + esc(msg) + '</div>' +
        '<button class="btn ghost small" onclick="this.parentNode.parentNode.style.display=\'none\'">知道了</button></div>';
      host.style.display = 'block';
    } catch (e) {}
  }
  function st(op) { if (!state[op]) state[op] = {}; return state[op]; }
  function opDef(op) { return SCHEMA.ops[op] || { groups: [] }; }
  function findField(op, key) {
    var groups = opDef(op).groups || [];
    for (var i = 0; i < groups.length; i++) {
      var fields = groups[i].fields || [];
      for (var j = 0; j < fields.length; j++) if (fields[j].key === key) return fields[j];
    }
    return null;
  }
  function fileKey(op) {
    var groups = opDef(op).groups || [];
    for (var i = 0; i < groups.length; i++) {
      var fields = groups[i].fields || [];
      for (var j = 0; j < fields.length; j++) if (fields[j].type === 'file') return fields[j].key;
    }
    return 'image';
  }

  // ---------- 主题 ----------
  function applyTheme(mode) {
    var dark = mode === 'dark';
    if (mode === 'system') {
      try {
        if (window.Android && window.Android.getSystemTheme) dark = window.Android.getSystemTheme() === 'dark';
      } catch (e) {}
      if (!window.Android && window.matchMedia) dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    try {
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      var mt = document.querySelector('meta[name=theme-color]');
      if (mt) mt.setAttribute('content', dark ? '#1B1B24' : '#6750A4');
    } catch (e) {}
  }
  function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
  }
  function setTheme(mode) {
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    applyTheme(mode);
    qa('#themeSeg button', function (b) { b.classList.toggle('active', b.dataset.theme === mode); });
    native('setTheme', mode);
  }

  // ---------- 字段渲染 ----------
  function needsAI(op, f) {
    return (op === 'generate' && f.key === 'prompt') ||
      (op === 'product' && f.key === 'desc') ||
      (op === 'style' && f.key === 'custom') ||
      (op === 'background' && f.key === 'custom') ||
      (op === 'cutout' && f.key === 'custom') ||
      (op === 'inpaint' && (f.key === 'remove' || f.key === 'keep')) ||
      (op === 'idphoto' && (f.key === 'outfit_custom' || f.key === 'hair_custom'));
  }

  function setSelectValue(op, key, value) {
    var host = document.getElementById('form-' + op) || document.getElementById('body-' + op);
    if (!host) return;
    var sel = host.querySelector('select[data-key="' + key + '"]');
    if (sel) { sel.value = value; st(op)[key] = value; }
  }
  function syncIdSpec(changed, value) {
    if (changed === 'type') {
      var spec = window.Prompts.specForType(value);
      if (spec) setSelectValue('idphoto', 'spec', spec);
    } else if (value === '自定义尺寸') {
      setSelectValue('idphoto', 'type', '自定义尺寸');
    }
  }

  function fieldNode(op, f) {
    st(op);
    var wide = ['textarea', 'file', 'dir', 'stylegrid', 'example', 'color'].indexOf(f.type) >= 0;
    var wrap = el('div', { class: 'field' + (wide ? ' wide' : '') });

    if (f.type === 'boolopt' || f.type === 'bool_true') {
      var box = el('input', { type: 'checkbox' });
      box.checked = !!f.default;
      box.dataset.key = f.key; box.dataset.type = f.type;
      box.onchange = function () {
        st(op)[f.key] = box.checked;
        if (op === 'retouch') scheduleRetouchPreview();
        if (op === 'batch' && f.key === 'recursive') refreshFolderInfo();
      };
      st(op)[f.key] = !!f.default;
      var label = el('label', { class: 'check' }, [box, document.createTextNode(f.label)]);
      if (f.help) {
        var bw = el('div', { class: 'field' });
        bw.appendChild(label);
        bw.appendChild(el('div', { class: 'hint', text: f.help }));
        return bw;
      }
      return label;
    }

    if (f.type === 'stylegrid') {
      wrap.appendChild(el('label', { text: f.label }));
      var grid = el('div', { class: 'style-grid' });
      (f.options || []).forEach(function (item) {
        var o = (typeof item === 'object') ? item : { label: item, desc: '', emoji: '' };
        var card = el('div', { class: 'style-card' + (o.label === f.default ? ' active' : '') });
        card.dataset.value = o.label;
        card.appendChild(el('span', { class: 'em', text: o.emoji || '✨' }));
        card.appendChild(el('span', { class: 'nm', text: o.label }));
        if (o.desc) card.appendChild(el('span', { class: 'ds', text: o.desc }));
        card.onclick = function () {
          var cards = grid.querySelectorAll('.style-card');
          for (var i = 0; i < cards.length; i++) cards[i].classList.remove('active');
          card.classList.add('active');
          st(op)[f.key] = o.label;
          if (op === 'upscale') updateUpscaleInfo();
        };
        grid.appendChild(card);
      });
      st(op)[f.key] = f.default;
      wrap.appendChild(grid);
      if (f.help) wrap.appendChild(el('div', { class: 'hint', text: f.help }));
      return wrap;
    }

    if (f.type === 'color') {
      wrap.appendChild(el('label', { text: f.label }));
      var row = el('div', { class: 'color-row' });
      var picker = el('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(f.default) ? f.default : '#438EDB' });
      var text = el('input', { type: 'text', value: f.default || '#438EDB', placeholder: '#RRGGBB' });
      picker.oninput = function () { text.value = picker.value; st(op)[f.key] = picker.value; };
      text.oninput = function () {
        if (/^#[0-9a-fA-F]{6}$/.test(text.value)) { picker.value = text.value; st(op)[f.key] = text.value; }
      };
      st(op)[f.key] = f.default || '#438EDB';
      row.appendChild(picker); row.appendChild(text); wrap.appendChild(row);
      var sw = el('div', { class: 'swatches' });
      ['#FFFFFF', '#438EDB', '#1F4E79', '#D9001B', '#EDEDED', '#F5F1E8', '#4CAF50', '#FF9800', '#9C27B0', '#00BCD4', '#3F51B5', '#000000'].forEach(function (c) {
        var sb = el('div', { class: 'swatch' }); sb.style.background = c; sb.title = c;
        sb.onclick = function () { picker.value = c; text.value = c; st(op)[f.key] = c; };
        sw.appendChild(sb);
      });
      wrap.appendChild(sw);
      return wrap;
    }

    wrap.appendChild(el('label', { text: f.label }));
    var input;

    if (f.type === 'select' || f.type === 'size') {
      input = el('select', {});
      var options = f.type === 'size' ? ['1K', '2K', '3K', '4K'] : (f.options || []);
      options.forEach(function (item) {
        var o = (typeof item === 'object') ? item : { label: item, value: item };
        input.appendChild(el('option', { value: o.value !== undefined ? o.value : o.label, text: o.label }));
      });
      input.value = f.default || '';
      input.onchange = function () {
        st(op)[f.key] = input.value;
        if (op === 'batch' && f.key === 'batch_op') renderBatchDynamic();
        if (op === 'upscale') updateUpscaleInfo();
        if (op === 'idphoto' && (f.key === 'type' || f.key === 'spec')) syncIdSpec(f.key, input.value);
      };
    } else if (f.type === 'textarea' || f.type === 'example') {
      input = el('textarea', { placeholder: f.help || '' });
      input.value = f.default || '';
      input.oninput = function () { st(op)[f.key] = input.value; };
      var actions = el('div', { class: 'field-actions' });
      if (f.example) {
        var exBtn = el('button', { class: 'btn ghost small', type: 'button', text: '填入示例' });
        exBtn.onclick = function () {
          input.value = f.example; st(op)[f.key] = input.value;
          toast('已填入示例，可直接修改');
        };
        actions.appendChild(exBtn);
      }
      var normBtn = el('button', { class: 'btn ghost small', type: 'button', text: '✨ 一键规范' });
      normBtn.onclick = function () { normalizeField(op, f, input); };
      actions.appendChild(normBtn);
      if (needsAI(op, f)) {
        var aiBtn = el('button', { class: 'btn secondary small', type: 'button', text: '🤖 AI 优化' });
        aiBtn.onclick = function () { aiEnhance(op, f, input, aiBtn); };
        actions.appendChild(aiBtn);
      }
      wrap.appendChild(input);
      wrap.appendChild(actions);
      if (f.help) wrap.appendChild(el('div', { class: 'hint', text: f.help }));
      return wrap;
    } else if (f.type === 'range') {
      input = el('input', { type: 'range' });
      var meta = f.meta || {};
      input.min = meta.min !== undefined ? meta.min : 0;
      input.max = meta.max !== undefined ? meta.max : 100;
      input.value = f.default;
      var rv = el('span', { class: 'range-val', text: String(f.default) });
      input.oninput = function () {
        rv.textContent = input.value;
        st(op)[f.key] = parseInt(input.value, 10);
        if (op === 'retouch') scheduleRetouchPreview();
      };
      st(op)[f.key] = parseInt(f.default, 10) || 0;
      wrap.appendChild(el('div', { class: 'range-row' }, [input, rv]));
      if (f.help) wrap.appendChild(el('div', { class: 'hint', text: f.help }));
      return wrap;
    } else if (f.type === 'file') {
      input = el('button', { class: 'btn ghost small', type: 'button', text: '🖼️ 选择图片' });
      input.onclick = function () {
        pendingPick = { op: op, key: f.key };
        st(op)[f.key] = null;
        native('pickImage');
      };
      wrap.appendChild(input);
      var pv = el('img', { class: 'picked', id: 'preview_' + op + '_' + f.key, alt: '预览' });
      pv.style.display = 'none';
      wrap.appendChild(pv);
      wrap.appendChild(el('div', { class: 'hint', id: 'info_' + op + '_' + f.key, text: '未选择图片' }));
      paintFile(op, f);
      return wrap;
    } else if (f.type === 'dir') {
      input = el('button', { class: 'btn ghost small', type: 'button', text: '📁 选择文件夹' });
      input.onclick = function () {
        pendingFolder = { op: op, key: f.key };
        native('pickFolder');
      };
      wrap.appendChild(input);
      wrap.appendChild(el('div', { class: 'hint', id: 'info_' + op + '_' + f.key, text: '未选择文件夹' }));
      refreshFolderInfo();
      return wrap;
    } else {
      input = el('input', { type: f.type === 'number' ? 'number' : 'text', placeholder: f.help || '' });
      input.value = f.default != null ? f.default : '';
      input.oninput = function () { st(op)[f.key] = input.value; };
    }

    input.dataset.key = f.key;
    input.dataset.type = f.type;
    wrap.appendChild(input);
    if (f.help) wrap.appendChild(el('div', { class: 'hint', text: f.help }));
    return wrap;
  }

  function paintFile(op, f) {
    var r = st(op)[f.key];
    var pv = document.getElementById('preview_' + op + '_' + f.key);
    var info = document.getElementById('info_' + op + '_' + f.key);
    if (!pv || !info) return;
    if (r && r.dataUri) {
      pv.src = r.dataUri; pv.style.display = 'block';
      info.textContent = '📐 ' + r.width + '×' + r.height + (r.name ? ' · ' + r.name : '');
    } else {
      pv.style.display = 'none';
      info.textContent = '未选择图片';
    }
  }

  function batchOpValue() {
    var sel = document.querySelector('#body-batch select[data-key="batch_op"], #form-batch select[data-key="batch_op"]');
    return sel ? sel.value : 'idphoto';
  }
  function realFieldKey(op, key) {
    if (op !== 'batch') return key;
    var m = String(key).match(/^(id|bg|rt|st|rs|up|co|cz)_(.+)$/);
    return m ? m[2] : key;
  }
  function normalizeField(op, f, input) {
    var text = (input.value || '').trim();
    if (!text && f.example) { input.value = f.example; text = f.example; }
    if (!text) { toast('请先填写内容，或点击“填入示例”'); return; }
    try {
      var realOp = op === 'batch' ? batchOpValue() : op;
      var out = window.Prompts.normalizeField(realOp, realFieldKey(op, f.key), text);
      input.value = out;
      st(op)[f.key] = out;
      toast('已整理为规范描述');
    } catch (e) {
      toast('整理失败：' + e.message, 'err');
    }
  }

  function aiEnhance(op, f, input, btn) {
    var text = (input.value || '').trim();
    if (!text && f.example) { input.value = f.example; text = f.example; }
    if (!text) { toast('请先填写内容，或点击“填入示例”'); return; }
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = '优化中…';
    enhanceText(text).then(function (out) {
      input.value = out;
      st(op)[f.key] = out;
      toast('AI 已优化为专业描述');
    }).catch(function (e) {
      toast('AI 优化失败：' + e.message, 'err');
    }).then(function () {
      btn.disabled = false; btn.textContent = old;
    });
  }

  // ---------- 精修单窗口实时预览 ----------
  function buildRetouchPreview() {
    var box = el('div', { class: 'retouch-live', id: 'retouchLive' });
    box.appendChild(el('div', { class: 'rl-head' }, [
      el('span', { class: 'rl-title', text: '🪞 实时预览' }),
      el('span', { class: 'rl-sub', id: 'retouchLiveSub', text: '拖动下方任意滑块查看效果' })
    ]));
    var stage = el('div', { class: 'rl-stage' });
    var img = el('img', { id: 'retouchPreviewImg', alt: '精修实时预览' });
    img.style.display = 'none';
    stage.appendChild(img);
    stage.appendChild(el('div', { class: 'rl-empty', id: 'retouchPreviewEmpty', text: '选择照片后，这里会实时显示精修效果' }));
    box.appendChild(stage);
    box.appendChild(el('div', { class: 'rl-bar' }, [
      el('button', { class: 'btn ghost small', type: 'button', text: '查看原图', onclick: toggleRetouchOriginal }),
      el('button', { class: 'btn ghost small', type: 'button', text: '重置参数', onclick: resetRetouch })
    ]));
    return box;
  }

  function toggleRetouchOriginal() {
    st('retouch')._showOriginal = !st('retouch')._showOriginal;
    updateRetouchPreview(true);
  }

  function resetRetouch() {
    var groups = opDef('retouch').groups || [];
    groups.forEach(function (g) {
      (g.fields || []).forEach(function (f) {
        if (f.type === 'range' || f.type === 'boolopt' || f.type === 'bool_true') {
          st('retouch')[f.key] = f.type === 'range' ? parseInt(f.default, 10) || 0 : !!f.default;
        }
      });
    });
    qa('#form-retouch [data-key]', function (node) {
      var f = findField('retouch', node.dataset.key);
      if (!f) return;
      if (f.type === 'range') {
        node.value = f.default;
        var rv = node.parentNode.querySelector('.range-val');
        if (rv) rv.textContent = String(f.default);
      } else if (f.type === 'boolopt' || f.type === 'bool_true') {
        node.checked = !!f.default;
      }
    });
    updateRetouchPreview(true);
    toast('已重置精修参数');
  }

  function scheduleRetouchPreview() {
    if (retouchTimer) clearTimeout(retouchTimer);
    retouchTimer = setTimeout(function () { updateRetouchPreview(false); }, 120);
  }

  function updateRetouchPreview(force) {
    var img = document.getElementById('retouchPreviewImg');
    var empty = document.getElementById('retouchPreviewEmpty');
    var sub = document.getElementById('retouchLiveSub');
    if (!img || !empty) return;
    var r = st('retouch').image;
    if (!r || !r.dataUri) {
      img.style.display = 'none'; empty.style.display = 'block';
      if (sub) sub.textContent = '选择照片后，这里会实时显示精修效果';
      return;
    }
    if (st('retouch')._showOriginal) {
      img.src = r.dataUri; img.style.display = 'block'; empty.style.display = 'none';
      if (sub) sub.textContent = '当前显示原图，再次点击“查看原图”回到效果';
      return;
    }
    if (sub) sub.textContent = '预览更新中…';
    var v = collectRaw('retouch');
    window.ImgTools.previewRetouch(r.dataUri, v, { max: 520 }).then(function (out) {
      img.src = out; img.style.display = 'block'; empty.style.display = 'none';
      if (sub) sub.textContent = '拖动任意滑块，预览会实时更新';
    }).catch(function () {
      if (sub) sub.textContent = '预览生成失败，可继续调整参数后直接生成';
    });
  }

  // ---------- 分组与面板 ----------
  function buildGroups(op, groups) {
    var frag = document.createDocumentFragment();
    (groups || []).forEach(function (g) {
      var card = el('div', { class: 'card' });
      card.appendChild(el('h2', {}, [document.createTextNode(g.icon + '  ' + g.title)]));
      if (op === 'retouch' && /精修参数/.test(g.title)) card.appendChild(buildRetouchPreview());
      var grid = el('div', { class: 'grid' });
      (g.fields || []).forEach(function (f) { grid.appendChild(fieldNode(op, f)); });
      card.appendChild(grid);
      frag.appendChild(card);
    });
    return frag;
  }

  function makeAction(op, isBatch) {
    var card = el('div', { class: 'card action-card' });
    if (isBatch) {
      var row = el('div', { class: 'row' });
      var runBtn = el('button', { class: 'btn', type: 'button', text: '▶ 开始批量处理' });
      runBtn.id = 'runBtn_' + op;
      runBtn.onclick = runBatch;
      var stopBtn = el('button', { class: 'btn danger', type: 'button', text: '■ 停止' });
      stopBtn.id = 'stopBtn_' + op;
      stopBtn.style.display = 'none';
      stopBtn.onclick = function () { batchStop = true; toast('正在停止，请等待当前图片处理完成'); };
      row.appendChild(runBtn); row.appendChild(stopBtn);
      card.appendChild(row);
      card.appendChild(el('div', { class: 'hint', id: 'batchStatus_' + op, text: '选择文件夹后开始；结果会自动保存到相册。' }));
    } else {
      var btn = el('button', { class: 'btn', type: 'button', text: '✨ 开始生成' });
      btn.id = 'runBtn_' + op;
      btn.onclick = function () { run(op); };
      card.appendChild(btn);
    }
    var pr = el('div', { class: 'progress', id: 'progress_' + op });
    pr.appendChild(el('div', { class: 'track' }, [el('div', { class: 'fill', id: 'progressFill_' + op })]));
    pr.appendChild(el('div', { class: 'txt', id: 'progressTxt_' + op }));
    card.appendChild(pr);
    card.appendChild(el('div', { id: 'result_' + op }));
    return card;
  }

  function buildPanel(op) {
    var body = el('div', { class: 'panel-body', id: 'body-' + op });
    var def = opDef(op);
    if (def.tip) {
      var tip = el('div', { class: 'card tip-card' });
      tip.appendChild(el('div', { class: 'hint', text: '💡 ' + def.tip }));
      body.appendChild(tip);
    }
    body.appendChild(buildGroups(op, def.groups));
    if (op === 'upscale') {
      var info = el('div', { class: 'card' });
      info.appendChild(el('div', { class: 'hint', id: 'upscaleInfo', text: '选择照片后显示放大后的尺寸。' }));
      body.appendChild(info);
    }
    body.appendChild(makeAction(op, op === 'batch'));
    return body;
  }

  function ensureSub(op) {
    if (BUILT[op]) return;
    var host = document.getElementById('form-' + op);
    if (!host) return;
    host.appendChild(buildPanel(op));
    host.dataset.built = '1';
    BUILT[op] = true;
    refreshAllFilePreviews(op);
    if (op === 'retouch') updateRetouchPreview(true);
    if (op === 'upscale') updateUpscaleInfo();
  }

  function refreshAllFilePreviews(op) {
    (opDef(op).groups || []).forEach(function (g) {
      (g.fields || []).forEach(function (f) {
        if (f.type === 'file') paintFile(op, f);
        if (f.type === 'dir') refreshFolderInfo();
      });
    });
  }

  function updateUpscaleInfo() {
    var info = document.getElementById('upscaleInfo');
    if (!info) return;
    var r = st('upscale').image;
    if (!r || !r.width) {
      info.textContent = '选择照片后显示放大后的尺寸。';
      return;
    }
    var v = collectRaw('upscale');
    var factor = window.Prompts.parseFactor(v.factor);
    var d = window.ImgTools.upscaleDims(r.width, r.height, factor, 4096);
    var local = String(v.mode || '').indexOf('本地') >= 0;
    info.innerHTML = '原图 <b>' + r.width + '×' + r.height + '</b> → 目标 <b>' + d.w + '×' + d.h + '</b><br>' +
      (local ? '本地无损放大：不调用 AI、不产生费用，只提升分辨率。' :
        'AI 细节增强：会补充纹理细节，处理时间较长；结果尺寸以实际输出为准。');
  }

  function collectRaw(op) {
    var values = {};
    var host = document.getElementById('form-' + op) || document.getElementById('body-' + op);
    if (!host) return values;
    qa('[data-key]', function (node) {
      var k = node.dataset.key, t = node.dataset.type;
      if (!k) return;
      if (t === 'bool_true' || t === 'boolopt') values[k] = node.checked;
      else if (t === 'range') values[k] = parseInt(node.value, 10);
      else values[k] = node.value;
    }, host);
    var def = opDef(op);
    (def.groups || []).forEach(function (g) {
      (g.fields || []).forEach(function (f) {
        if (f.type === 'stylegrid' && st(op)[f.key] !== undefined) values[f.key] = st(op)[f.key];
        if (f.type === 'color' && st(op)[f.key] !== undefined) values[f.key] = st(op)[f.key];
      });
    });
    // 批量动态参数里的风格卡片没有 data-key，需要从 state 补回
    if (op === 'batch') {
      var bgroups = (def.batchGroups || {})[batchOpValue()] || [];
      bgroups.forEach(function (g) {
        (g.fields || []).forEach(function (f) {
          if ((f.type === 'stylegrid' || f.type === 'color') && st('batch')[f.key] !== undefined) {
            values[f.key] = st('batch')[f.key];
          }
        });
      });
    }
    return values;
  }

  // ---------- 图片 / 文件夹选择回调 ----------
  window.onImagePicked = function (json) {
    var r = typeof json === 'string' ? JSON.parse(json) : json;
    if (!r || !r.ok) {
      var err = r && r.error ? r.error : '未知错误';
      if (err.indexOf('已取消') < 0) toast('选择图片失败：' + err, 'err');
      pendingPick = null;
      return;
    }
    var pick = pendingPick || { op: currentOp, key: fileKey(currentOp) };
    pendingPick = null;
    st(pick.op)[pick.key] = r;
    var f = findField(pick.op, pick.key);
    if (f) paintFile(pick.op, f);
    if (pick.op === 'retouch') {
      st('retouch')._showOriginal = false;
      updateRetouchPreview(true);
    }
    if (pick.op === 'upscale') updateUpscaleInfo();
    toast('已选择图片');
  };

  window.onFolderPicked = function (json) {
    var r = typeof json === 'string' ? JSON.parse(json) : json;
    if (!r || !r.ok) {
      var err = r && r.error ? r.error : '未知错误';
      if (err.indexOf('已取消') < 0) toast('选择文件夹失败：' + err, 'err');
      pendingFolder = null;
      return;
    }
    var pick = pendingFolder || { op: 'batch', key: 'input_dir' };
    pendingFolder = null;
    st(pick.op).folderUri = r.uri;
    refreshFolderInfo();
    toast('已选择文件夹');
  };

  function refreshFolderInfo() {
    var info = document.getElementById('info_batch_input_dir');
    var uri = st('batch').folderUri;
    if (!info) return;
    if (!uri) { info.textContent = '未选择文件夹'; return; }
    info.textContent = '📁 已选择文件夹，正在统计图片…';
    var v = collectRaw('batch');
    listImagesAsync(uri, !!v.recursive).then(function (files) {
      info.textContent = '📁 找到 ' + files.length + ' 张图片';
    }).catch(function () {
      info.textContent = '📁 已选择文件夹（统计失败，仍可开始处理）';
    });
  }

  // ---------- 异步 API ----------
  function apiCallAsync(formId, prompt, size, ratio, uris) {
    return new Promise(function (resolve, reject) {
      var id = 'api_' + (++apiSeq);
      _apiMeta[id] = { formId: formId };
      _apiPending[id] = { resolve: resolve, reject: reject };
      var payload = { prompt: prompt, size: size || '2K' };
      if (ratio) payload.ratio = ratio;
      if (uris && uris.length) payload.images = uris;
      var r = native('callApiAsync', JSON.stringify(payload), id);
      if (r && r.ok === false) {
        delete _apiMeta[id]; delete _apiPending[id];
        reject(new Error(r.error || '无法开始生成'));
      }
    });
  }
  window.__apiProgress = function (id, text, pct) {
    var meta = _apiMeta[id];
    if (!meta) return;
    setProgress(meta.formId, text, pct);
  };
  window.__apiResult = function (id, res) {
    var meta = _apiMeta[id], cb = _apiPending[id];
    delete _apiMeta[id]; delete _apiPending[id];
    if (!cb) return;
    if (!res || res.ok === false) cb.reject(new Error(res && res.error ? res.error : '生成失败'));
    else cb.resolve(res);
  };

  function enhanceText(text) {
    return new Promise(function (resolve, reject) {
      var id = 'enh_' + (++enhanceSeq);
      _enhancePending[id] = { resolve: resolve, reject: reject };
      var r = native('enhancePromptAsync', text, id);
      if (r && r.ok === false) {
        delete _enhancePending[id];
        reject(new Error(r.error || '无法启动 AI 优化'));
      }
    });
  }
  window.__enhanceProgress = function (id, text, pct) {
    if (_enhancePending[id]) toast(text + '（' + pct + '%）');
  };
  window.__enhanceResult = function (id, res) {
    var cb = _enhancePending[id];
    delete _enhancePending[id];
    if (!cb) return;
    if (!res || res.ok === false) cb.reject(new Error(res && res.error ? res.error : '优化失败'));
    else cb.resolve(res.result || '');
  };

  function listImagesAsync(uri, recursive) {
    return new Promise(function (resolve, reject) {
      var id = 'list_' + (++listSeq);
      _listPending[id] = { resolve: resolve, reject: reject };
      var r = native('listImagesAsync', uri, recursive ? '1' : '0', id);
      if (r && r.ok === false) {
        delete _listPending[id];
        reject(new Error(r.error || '读取文件夹失败'));
      }
    });
  }
  window.__listResult = function (id, res) {
    var cb = _listPending[id];
    delete _listPending[id];
    if (!cb) return;
    if (!res || res.ok === false) cb.reject(new Error(res && res.error ? res.error : '读取文件夹失败'));
    else cb.resolve(res.files || []);
  };

  function saveItems(items) {
    return new Promise(function (resolve, reject) {
      var id = 'save_' + (++saveSeq);
      _savePending[id] = { resolve: resolve, reject: reject };
      var payload = (items || []).map(function (it) {
        return { dataUrl: it.url, name: it.name };
      });
      var r = native('saveImagesAsync', JSON.stringify(payload), id);
      if (r && r.ok === false) {
        delete _savePending[id];
        reject(new Error(r.error || '保存失败'));
      }
    });
  }
  window.__saveImagesResult = function (id, res) {
    var cb = _savePending[id];
    delete _savePending[id];
    if (!cb) return;
    if (!res || res.ok === false) cb.reject(new Error(res && res.error ? res.error : '保存失败'));
    else cb.resolve(res.results || []);
  };

  function readImageAsync(uri, full) {
    return new Promise(function (resolve, reject) {
      var id = 'read_' + (++readSeq);
      _readPending[id] = { resolve: resolve, reject: reject };
      var r = native('readImageAsync', uri, full ? '1' : '0', id);
      if (r && r.ok === false) {
        delete _readPending[id];
        reject(new Error(r.error || '读取图片失败'));
      }
    });
  }
  window.__readImageResult = function (id, res) {
    var cb = _readPending[id];
    delete _readPending[id];
    if (!cb) return;
    if (!res || res.ok === false) cb.reject(new Error(res && res.error ? res.error : '读取图片失败'));
    else cb.resolve(res);
  };

  function testConnectionAsync() {
    return new Promise(function (resolve, reject) {
      var id = 'test_' + (++testSeq);
      _testPending[id] = { resolve: resolve, reject: reject };
      var r = native('testConnectionAsync', id);
      if (r && r.ok === false) {
        delete _testPending[id];
        reject(new Error(r.error || '无法测试连接'));
      }
    });
  }
  window.__testResult = function (id, res) {
    var cb = _testPending[id];
    delete _testPending[id];
    if (!cb) return;
    if (!res || res.ok === false) cb.reject(new Error(res && res.error ? res.error : '连接失败'));
    else cb.resolve(res.message || '连接成功');
  };

  // ---------- 进度 / 按钮状态 ----------
  function setProgress(op, text, pct) {
    var pr = document.getElementById('progress_' + op);
    var fill = document.getElementById('progressFill_' + op);
    var txt = document.getElementById('progressTxt_' + op);
    if (pr) pr.style.display = 'block';
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (txt) txt.textContent = text + (pct >= 0 ? '（' + Math.round(pct) + '%）' : '');
  }
  function hideProgress(op) {
    var pr = document.getElementById('progress_' + op);
    if (pr) pr.style.display = 'none';
  }
  function setBusy(op, busy) {
    var btn = document.getElementById('runBtn_' + op);
    var stop = document.getElementById('stopBtn_' + op);
    if (btn) {
      btn.disabled = busy;
      if (busy) {
        if (!btn.dataset.oldText) btn.dataset.oldText = btn.textContent;
        btn.textContent = op === 'batch' ? '处理中…' : '生成中…';
        btn.classList.add('busy');
      } else {
        btn.textContent = btn.dataset.oldText || (op === 'batch' ? '▶ 开始批量处理' : '✨ 开始生成');
        btn.classList.remove('busy');
      }
    }
    if (stop) stop.style.display = busy ? 'block' : 'none';
  }
  function resultBox(op) { return document.getElementById('result_' + op); }
  function clearResult(op) { var b = resultBox(op); if (b) b.innerHTML = ''; }

  function showResultError(op, err) {
    var b = resultBox(op);
    if (b) b.innerHTML = '<div class="msg err">❌ ' + esc(err && err.message ? err.message : err) +
      '</div><div class="row"><button class="btn ghost" onclick="retryOp(\'' + op + '\')">重试</button></div>';
    toast('处理失败：' + (err && err.message ? err.message : err), 'err');
  }
  window.retryOp = function (op) { run(op); };

  // ---------- 执行单个功能 ----------
  function getInputImage(op) {
    return st(op)[fileKey(op)] || null;
  }

  function ratioFor(op, v, image, built) {
    if (op === 'idphoto' && built && built.spec) return window.Prompts.closestRatio(built.spec.px[0], built.spec.px[1]);
    if (op === 'product' && built && built.purpose) return built.purpose.ratio;
    if (op === 'avatar') return '1:1';
    if (op === 'outpaint' || op === 'generate') return v.ratio || null;
    if (image && image.width && image.height) return window.Prompts.closestRatio(image.width, image.height);
    return null;
  }

  function run(op) {
    if (op === 'batch') { runBatch(); return; }
    var v = collectRaw(op);
    var image = getInputImage(op);
    var requiresImage = op !== 'generate';
    if (requiresImage && (!image || !image.uri)) {
      showResultError(op, new Error('请先选择一张图片。'));
      return;
    }
    if (op === 'generate' && !(v.prompt || '').trim()) {
      showResultError(op, new Error('请填写画面描述，或点击“AI 优化”让 AI 帮你写。'));
      return;
    }
    var built;
    try { built = window.Prompts.build(op, v); }
    catch (e) { showResultError(op, e); return; }

    if (v.dry_run) {
      var b = resultBox(op);
      if (b) b.innerHTML = '<div class="card"><h2>📝 本次提示词预览</h2><div style="white-space:pre-wrap;line-height:1.6">' +
        esc(built.prompt) + '</div><div class="hint">取消“只预览提示词”后即可正式生成。</div></div>';
      return;
    }

    clearResult(op);
    setBusy(op, true);
    setProgress(op, '准备中…', 2);

    // 本地无损放大：不调用 API
    if (op === 'upscale' && built.local) {
      if (!image || !image.uri) { setBusy(op, false); showResultError(op, new Error('本地放大需要原图文件，请重新选择图片。')); return; }
      setProgress(op, '读取原图（本地无损放大）…', 12);
      readImageAsync(image.uri, true).then(function (full) {
        setProgress(op, '本地无损放大中…', 45);
        return window.ImgTools.localUpscale(full.dataUri, built.factor, 4096).then(function (url) {
          setProgress(op, '完成', 100);
          var dims = window.ImgTools.upscaleDims(full.width, full.height, built.factor, 4096);
          return {
            url: url,
            name: '无损放大_' + dims.w + 'x' + dims.h + '.png',
            label: '本地无损放大 ' + v.factor + ' · ' + dims.w + '×' + dims.h
          };
        });
      }).then(function (item) {
        return finalize(op, [item], built.prompt);
      }).catch(function (e) {
        showResultError(op, e);
      }).then(function () {
        hideProgress(op); setBusy(op, false);
      });
      return;
    }

    var uris = image && image.uri ? [image.uri] : (image && image.dataUri ? [image.dataUri] : null);
    apiCallAsync(op, built.prompt, v.size, ratioFor(op, v, image, built), uris)
      .then(function (res) { return postProcess(op, res, v, image, built); })
      .then(function (out) { return finalize(op, out.items, built.prompt); })
      .catch(function (e) { showResultError(op, e); })
      .then(function () { hideProgress(op); setBusy(op, false); });
  }

  function dataUrlFor(b64) {
    var head = String(b64 || '').slice(0, 8);
    var mime = head.indexOf('/9j/') === 0 ? 'image/jpeg' : 'image/png';
    return 'data:' + mime + ';base64,' + b64;
  }

  function postProcess(op, res, v, image, built) {
    if (!res || res.ok === false) return Promise.reject(new Error(res && res.error ? res.error : '生成失败'));
    var src = dataUrlFor(res.data);
    var iw = image && image.width ? image.width : 1024;
    var ih = image && image.height ? image.height : 1024;
    var chain;
    if (op === 'idphoto' && built.spec) {
      var spec = built.spec;
      var fill = window.Prompts.idBgHex(v.bg, v.color);
      chain = window.ImgTools.fitToCanvas(src, spec.px[0], spec.px[1], { fill: fill }).then(function (single) {
        var items = [{ url: single, name: '证件照_' + spec.label + '.png', label: '证件照 ' + spec.px.join('×') }];
        var layout = window.Prompts.layoutInfo(v);
        if (layout) {
          return window.ImgTools.makeSheet(single, spec.px[0], spec.px[1], layout).then(function (sheet) {
            items.push({ url: sheet, name: layout.label + '_排版.png', label: layout.label + ' 排版' });
            return items;
          });
        }
        return items;
      });
    } else if (op === 'cutout') {
      var bgLabel = v.bg || '透明背景';
      if (built.transparent) {
        chain = window.ImgTools.removeBackgroundToTransparent(src, { tolerance: 48, feather: 2, maxEdge: 2048 })
          .then(function (url) {
            return [{ url: url, name: '抠图_透明底.png', label: '透明背景 PNG' }];
          });
      } else {
        var bgFill = bgLabel === '自定义颜色' ? (v.color || '#FFFFFF') :
          (bgLabel === '纯白背景' ? '#FFFFFF' : (bgLabel === '标准蓝背景' ? '#438EDB' : '#FFFFFF'));
        chain = window.ImgTools.fitToCanvas(src, iw, ih, { fill: bgFill })
          .then(function (url) {
            return [{ url: url, name: '抠图_' + bgLabel + '.png', label: bgLabel }];
          });
      }
    } else if (op === 'product') {
      var purpose = built.purpose || window.Prompts.PRODUCT_PURPOSE['电商主图 1:1'];
      chain = window.ImgTools.fitToRatio(src, purpose.ratio, { mode: 'contain', fill: '#FFFFFF', maxSize: 2048 })
        .then(function (url) {
          return [{ url: url, name: '商品图_' + purpose.label + '.png', label: '商品图 · ' + purpose.label }];
        });
    } else if (op === 'avatar') {
      chain = window.ImgTools.fitToRatio(src, '1:1', { mode: 'cover', maxSize: 1600 })
        .then(function (url) {
          return [{ url: url, name: '头像_' + Date.now() + '.png', label: '头像 1:1' }];
        });
    } else if (op === 'upscale') {
      var dims = image ? window.ImgTools.upscaleDims(image.width, image.height, built.factor, 4096) : null;
      chain = dims ? window.ImgTools.resizeTo(src, dims.w, dims.h) : Promise.resolve(src);
      chain = chain.then(function (url) {
        return [{
          url: url,
          name: 'AI放大_' + (dims ? dims.w + 'x' + dims.h : Date.now()) + '.png',
          label: 'AI 高清放大 ' + (v.factor || '') + (dims ? ' · ' + dims.w + '×' + dims.h : '')
        }];
      });
    } else {
      var fit = ['background', 'retouch', 'style', 'restore', 'inpaint', 'colorize'].indexOf(op) >= 0;
      if (fit && v.fit !== false && image && image.width) {
        chain = window.ImgTools.fitToCanvas(src, iw, ih, { fill: '#FFFFFF' })
          .then(function (url) {
            return [{ url: url, name: op + '_' + Date.now() + '.png', label: SCHEMA.labels[op] || '结果图' }];
          });
      } else {
        chain = Promise.resolve([{ url: src, name: op + '_' + Date.now() + '.png', label: SCHEMA.labels[op] || '结果图' }]);
      }
    }
    return chain.then(function (items) { return { items: items, prompt: built.prompt }; });
  }

  function finalize(op, items, prompt) {
    showResult(op, items, prompt);
    var auto = isAutoSave();
    var savePromise = auto ? saveItems(items).then(function (results) {
      var saved = 0, paths = [];
      results.forEach(function (r, i) {
        if (r.ok) {
          saved++;
          if (items[i]) items[i].path = r.path;
          if (r.path) paths.push(r.path);
        }
      });
      var info = document.getElementById('saveInfo_' + op);
      if (info) {
        info.innerHTML = saved
          ? '<div class="msg ok">✅ 已自动保存 ' + saved + ' 张到相册：' + esc(paths.join('、')) + '</div>'
          : '<div class="msg err">⚠️ 自动保存失败，可点击图片下方“保存到相册”手动保存。</div>';
      }
      if (saved) markSavedResults();
      return saved;
    }).catch(function (e) {
      var info = document.getElementById('saveInfo_' + op);
      if (info) info.innerHTML = '<div class="msg err">⚠️ 自动保存失败：' + esc(e.message) + '。可手动保存。</div>';
      return 0;
    }) : (function () {
      var info = document.getElementById('saveInfo_' + op);
      if (info) info.innerHTML = '<div class="msg info">自动保存已关闭。点击图片下方“保存到相册”可手动保存。</div>';
      return Promise.resolve(0);
    })();
    return savePromise.then(function () {
      return saveHistory(op, items, prompt);
    }).then(function () {
      if (auto) toast('生成完成，已自动保存到相册');
    });
  }

  function isAutoSave() {
    return String(APP_CFG.auto_save === undefined ? 'true' : APP_CFG.auto_save) !== 'false';
  }

  function showResult(op, items, prompt, extraMsg) {
    var html = extraMsg ? '<div class="msg ok">' + esc(extraMsg) + '</div>' :
      '<div class="msg ok">✅ 处理完成</div>';
    html += '<div id="saveInfo_' + op + '"></div>';
    if (prompt) {
      html += '<details><summary>查看本次提示词</summary><pre>' + esc(prompt) + '</pre></details>';
    }
    if (items && items.length) {
      html += '<div class="imgs">';
      items.forEach(function (it, i) {
        html += '<div class="item" data-idx="' + i + '"><img src="' + it.url + '" alt="结果" onclick="openLightboxIndex(' + i + ')">' +
          '<div class="cap">' + esc(it.label || '') + (it.path ? '<br>✅ 已保存' : '<br>尚未保存') + '</div>' +
          '<button class="btn ghost small" onclick="saveResult(' + i + ')">保存到相册</button></div>';
      });
      html += '</div>';
      if (items.length > 1) {
        html += '<div class="row"><button class="btn secondary" onclick="saveAllResults()">保存全部</button></div>';
      }
    }
    var b = resultBox(op);
    if (b) b.innerHTML = html;
    _lastResults = items || [];
  }

  window.saveResult = function (i) {
    var it = (_lastResults || [])[i];
    if (!it) return;
    var r = native('saveImage', it.url, it.name || ('AI相馆_' + Date.now() + '.png'));
    if (r.ok) {
      it.path = r.path;
      toast('已保存：' + r.path);
    } else {
      toast('保存失败：' + r.error, 'err');
    }
  };
  window.saveAllResults = function () {
    if (!_lastResults || !_lastResults.length) return;
    saveItems(_lastResults).then(function (results) {
      var saved = 0;
      results.forEach(function (r, i) {
        if (r.ok) { saved++; _lastResults[i].path = r.path; }
      });
      markSavedResults();
      toast('已保存 ' + saved + ' 张到相册');
    }).catch(function (e) { toast('保存失败：' + e.message, 'err'); });
  };
  function markSavedResults() {
    qa('.imgs .item', function (node) {
      var i = parseInt(node.dataset.idx, 10);
      var cap = node.querySelector('.cap');
      if (cap && _lastResults[i] && _lastResults[i].path) cap.innerHTML = esc(_lastResults[i].label || '') + '<br>✅ 已保存';
    });
  }

  // ---------- 大图预览 ----------
  window.openLightboxIndex = function (i) {
    openLightboxList(_lastResults, i, '生成结果');
  };
  window.openLightboxUrl = function (url) {
    openLightboxList([{ url: url, name: 'AI相馆_' + Date.now() + '.png', label: '历史预览' }], 0, '历史预览');
  };
  function openLightboxList(list, index, title) {
    _lbList = list || [];
    _lbIndex = index || 0;
    if (!_lbList.length) return;
    document.getElementById('lightboxTitle').textContent = title || '';
    renderLightbox();
    document.getElementById('lightbox').style.display = 'flex';
  }
  function renderLightbox() {
    var it = _lbList[_lbIndex];
    if (!it) return;
    document.getElementById('lightboxImg').src = it.url;
    document.getElementById('lightboxCounter').textContent =
      _lbList.length > 1 ? (_lbIndex + 1) + ' / ' + _lbList.length : '';
    document.getElementById('lbPrev').style.display = _lbIndex > 0 ? 'block' : 'none';
    document.getElementById('lbNext').style.display = _lbIndex < _lbList.length - 1 ? 'block' : 'none';
  }
  window.lightboxPrev = function () { if (_lbIndex > 0) { _lbIndex--; renderLightbox(); } };
  window.lightboxNext = function () { if (_lbIndex < _lbList.length - 1) { _lbIndex++; renderLightbox(); } };
  window.closeLightbox = function () { document.getElementById('lightbox').style.display = 'none'; };
  window.saveLightbox = function () {
    var it = _lbList[_lbIndex];
    if (!it) return;
    var r = native('saveImage', it.url, it.name || ('AI相馆_' + Date.now() + '.png'));
    toast(r.ok ? ('已保存：' + r.path) : ('保存失败：' + r.error), r.ok ? 'ok' : 'err');
  };

  // ---------- 历史 ----------
  function saveHistory(op, items, prompt) {
    if (!items || !items.length) return Promise.resolve();
    var entry = {
      id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      op: op,
      label: SCHEMA.labels[op] || op,
      time: new Date().toLocaleString('zh-CN'),
      prompt: prompt || '',
      items: []
    };
    var limited = items.slice(0, 4);
    var transparent = op === 'cutout' && /透明/.test((items[0] || {}).label || '');
    return Promise.all(limited.map(function (it) {
      return Promise.all([
        window.ImgTools.makeThumb(it.url, 240, 320, { transparent: transparent }),
        window.ImgTools.makePreview(it.url, 760, 0.78, { transparent: transparent })
      ]).then(function (arr) {
        return {
          thumb: arr[0], preview: arr[1],
          name: it.name || '', label: it.label || '',
          path: it.path || ''
        };
      });
    })).then(function (list) {
      entry.items = list;
      var r = native('saveHistory', JSON.stringify(entry));
      if (r && r.ok === false) throw new Error(r.error || '保存历史失败');
    }).catch(function (e) {
      // 历史失败不阻断主流程
      console.log('history save failed', e);
    });
  }

  function openHistory() {
    document.getElementById('historySheet').style.display = 'block';
    loadHistory();
  }
  window.openHistory = openHistory;
  function closeHistory() { document.getElementById('historySheet').style.display = 'none'; }
  window.closeHistory = closeHistory;
  function loadHistory() {
    var r = native('getHistory');
    var items = (r && r.items) || [];
    var grid = document.getElementById('historyGrid');
    var empty = document.getElementById('historyEmpty');
    var count = document.getElementById('historyCount');
    var auto = document.getElementById('historyAutoSave');
    grid.innerHTML = '';
    if (count) count.textContent = items.length ? ('共 ' + items.length + ' 条') : '';
    if (auto) auto.textContent = isAutoSave() ? '生成后自动保存：开' : '生成后自动保存：关';
    if (empty) empty.style.display = items.length ? 'none' : 'block';
    items.forEach(function (entry) {
      var card = el('div', { class: 'history-card' });
      var head = el('div', { class: 'hc-head' }, [
        el('b', { text: entry.label || '生成记录' }),
        el('span', { text: entry.time || '' })
      ]);
      card.appendChild(head);
      var thumbs = el('div', { class: 'hc-thumbs' });
      var list = entry.items || [];
      list.slice(0, 3).forEach(function (it, idx) {
        var im = el('img', { src: it.thumb || it.preview, alt: '历史缩略图' });
        im.onclick = function () {
          openLightboxList(list.map(function (x) {
            return { url: x.preview || x.thumb, name: x.name, label: x.label, path: x.path };
          }), idx, entry.label || '历史记录');
        };
        thumbs.appendChild(im);
      });
      if (list.length > 3) thumbs.appendChild(el('div', { class: 'hc-more', text: '+' + (list.length - 3) }));
      card.appendChild(thumbs);
      if (entry.prompt) {
        card.appendChild(el('details', {}, [
          el('summary', { text: '查看提示词' }),
          el('pre', { text: entry.prompt })
        ]));
      }
      var actions = el('div', { class: 'hc-actions' });
      var view = el('button', { class: 'btn ghost small', type: 'button', text: '查看' });
      view.onclick = function () {
        if (!list.length) return;
        openLightboxList(list.map(function (x) {
          return { url: x.preview || x.thumb, name: x.name, label: x.label, path: x.path };
        }), 0, entry.label || '历史记录');
      };
      var del = el('button', { class: 'btn danger small', type: 'button', text: '删除' });
      del.onclick = function () {
        if (!confirm('删除这条历史记录？（已保存到相册的原图不会删除）')) return;
        native('deleteHistory', entry.id);
        loadHistory();
      };
      actions.appendChild(view); actions.appendChild(del);
      card.appendChild(actions);
      grid.appendChild(card);
    });
  }
  window.clearHistory = function () {
    if (!confirm('确定清空所有历史记录？已保存到相册的原图不会删除。')) return;
    native('clearHistory');
    loadHistory();
    toast('历史记录已清空');
  };

  // ---------- 设置 ----------
  function openSettings() {
    document.getElementById('settingsSheet').style.display = 'block';
    var loaded = native('getConfig');
    if (loaded && loaded.ok !== false) APP_CFG = loaded;
    var fields = [
      ['api_key', 'API Key（留空表示不修改）', 'password'],
      ['base_url', 'Base URL', 'text'],
      ['model', '图像模型名', 'text'],
      ['text_model', '文本模型名（AI 优化提示词用）', 'text'],
      ['timeout', '超时（秒）', 'number'],
      ['max_upload_mb', '上传上限 MB', 'number'],
      ['max_long_edge', '长边上限 px', 'number'],
      ['size', '默认输出档位', 'select']
    ];
    var form = document.getElementById('settingsForm');
    form.innerHTML = '';
    fields.forEach(function (f) {
      var wrap = el('div', { class: 'field' });
      wrap.appendChild(el('label', { text: f[1] }));
      var input;
      if (f[0] === 'size') {
        input = el('select', { id: 'cfg_' + f[0] });
        ['1K', '2K', '3K', '4K'].forEach(function (v) {
          input.appendChild(el('option', { value: v, text: v }));
        });
        input.value = APP_CFG[f[0]] || '2K';
      } else {
        input = el('input', {
          type: f[2], id: 'cfg_' + f[0],
          value: f[0] === 'api_key' ? '' : (APP_CFG[f[0]] || '')
        });
      }
      if (f[0] === 'api_key') {
        input.placeholder = APP_CFG.api_key ? ('当前：' + APP_CFG.api_key) : '请输入 Agnes API Key';
      }
      if (f[0] === 'base_url') input.placeholder = 'https://apihub.agnes-ai.com/v1';
      wrap.appendChild(input); form.appendChild(wrap);
    });
    var autoWrap = el('label', { class: 'check' });
    var autoBox = el('input', { type: 'checkbox', id: 'cfg_auto_save' });
    autoBox.checked = isAutoSave();
    autoWrap.appendChild(autoBox);
    autoWrap.appendChild(document.createTextNode('生成后自动保存到相册（Download/AIPhotoStudio）'));
    form.appendChild(autoWrap);
    form.appendChild(el('div', { class: 'hint', text: '开启自动保存时，生成完成会立即写入相册；关闭后可在结果图下方手动保存。历史记录只保存预览图，原图请在相册中查看。' }));
    var ver = native('getAppVersion') || {};
    form.appendChild(el('div', { class: 'hint', id: 'settingsVersion', text: '版本：' + (ver.version || '3.0') }));
    var msg = document.getElementById('settingsMsg');
    if (msg) msg.innerHTML = '';
    var theme = getStoredTheme();
    qa('#themeSeg button', function (b) { b.classList.toggle('active', b.dataset.theme === theme); });
  }
  window.openSettings = openSettings;
  function closeSettings() { document.getElementById('settingsSheet').style.display = 'none'; }
  window.closeSettings = closeSettings;

  function saveSettings() {
    var data = {};
    ['api_key', 'base_url', 'model', 'text_model', 'timeout', 'max_upload_mb', 'max_long_edge', 'size'].forEach(function (k) {
      var node = document.getElementById('cfg_' + k);
      if (node) data[k] = (node.value || '').trim();
    });
    var auto = document.getElementById('cfg_auto_save');
    data.auto_save = auto && auto.checked ? 'true' : 'false';
    var r = native('saveConfig', JSON.stringify(data));
    if (r.ok) {
      APP_CFG = native('getConfig') || APP_CFG;
      document.getElementById('settingsMsg').innerHTML = '<div class="msg ok">✅ 设置已保存</div>';
      toast('设置已保存');
    } else {
      document.getElementById('settingsMsg').innerHTML = '<div class="msg err">❌ ' + esc(r.error) + '</div>';
    }
  }
  window.saveSettings = saveSettings;

  function testConnection() {
    var msg = document.getElementById('settingsMsg');
    msg.innerHTML = '<div class="msg info">正在测试连接…</div>';
    testConnectionAsync().then(function (text) {
      msg.innerHTML = '<div class="msg ok">✅ ' + esc(text) + '</div>';
    }).catch(function (e) {
      msg.innerHTML = '<div class="msg err">❌ ' + esc(e.message) + '</div>';
    });
  }
  window.testConnection = testConnection;

  // ---------- 批量 ----------
  var BATCH_PREFIX = {
    idphoto: 'id', background: 'bg', retouch: 'rt', style: 'st',
    restore: 'rs', upscale: 'up', cutout: 'co', colorize: 'cz',
    inpaint: 'ip', product: 'pd', avatar: 'av'
  };

  function renderBatchDynamic() {
    var sel = document.querySelector('#body-batch select[data-key="batch_op"], #form-batch select[data-key="batch_op"]');
    if (!sel) return;
    var op = sel.value;
    var host = document.getElementById('batchDynamic');
    if (!host) return;
    host.innerHTML = '';
    var groups = ((opDef('batch').batchGroups || {})[op]) || [];
    // 批量参数不重复显示“选择图片”字段
    var filtered = groups.map(function (g) {
      return {
        type: 'group', title: g.title, icon: g.icon,
        fields: (g.fields || []).filter(function (f) { return f.type !== 'file' && f.type !== 'dir'; })
      };
    });
    host.appendChild(buildGroups('batch', filtered));
    st('batch');
  }

  function mapPrefixValues(op, v, prefix) {
    var out = {};
    (opDef(op).groups || []).forEach(function (g) {
      (g.fields || []).forEach(function (f) {
        var full = prefix + '_' + f.key;
        if (v[full] !== undefined) out[f.key] = v[full];
      });
    });
    out.extra = v.extra;
    out.size = v.size;
    out.dry_run = v.dry_run;
    return out;
  }

  function batchOutputName(fileName, op, index, ext) {
    var base = String(fileName || 'image').replace(/\.[^.]+$/, '');
    base = base.replace(/[\\/:*?"<>|]/g, '_');
    return base + '_' + op + (index ? '_' + index : '') + (ext || '.png');
  }

  function runBatch() {
    var v = collectRaw('batch');
    if (!st('batch').folderUri) { showResultError('batch', new Error('请先选择输入文件夹。')); return; }
    var op = v.batch_op || 'idphoto';
    batchStop = false;
    clearResult('batch');
    setBusy('batch', true);
    setProgress('batch', '正在扫描文件夹…', 2);
    var status = document.getElementById('batchStatus_batch');
    if (status) status.textContent = '正在扫描文件夹…';

    listImagesAsync(st('batch').folderUri, !!v.recursive).then(function (all) {
      var files = all || [];
      if (parseInt(v.limit, 10) > 0) files = files.slice(0, parseInt(v.limit, 10));
      if (!files.length) throw new Error('文件夹中没有找到图片。');
      var bv = mapPrefixValues(op, v, BATCH_PREFIX[op] || 'id');
      bv.size = v.size; bv.extra = v.extra; bv.dry_run = false;
      if (v.dry_run) {
        var sample = window.Prompts.build(op, bv);
        var b = resultBox('batch');
        if (b) b.innerHTML = '<div class="msg info">找到 ' + files.length + ' 张图片，将执行：' +
          esc(SCHEMA.labels[op] || op) + '。取消“只预览提示词”后开始处理。</div>' +
          '<details open><summary>参数提示词预览</summary><pre>' + esc(sample.prompt) + '</pre></details>';
        return { dry: true, count: files.length };
      }
      var results = [], ok = 0, fail = 0, done = 0;
      return new Promise(function (resolve) {
        function step(i) {
          if (batchStop || i >= files.length) { resolve({ results: results, ok: ok, fail: fail, total: files.length }); return; }
          var file = files[i];
          var pct = Math.round((i / files.length) * 100);
          setProgress('batch', '第 ' + (i + 1) + '/' + files.length + ' 张：' + (file.name || ''), pct);
          if (status) status.textContent = '正在处理：' + (file.name || '') + '（' + (i + 1) + '/' + files.length + '）';

          var firstOut = batchOutputName(file.name, op, 0, '.png');
          if (v.skip_existing) {
            var exists = native('existsImage', firstOut);
            if (exists && exists.exists) {
              done++; ok++;
              step(i + 1);
              return;
            }
          }

          var info = native('imageInfo', file.uri);
          var image = info && info.ok ? { uri: file.uri, width: info.width, height: info.height } : { uri: file.uri };
          var local = op === 'upscale' && (bv.mode || '').indexOf('本地') >= 0;

          function afterItems(items) {
            items.forEach(function (it, idx) {
              it.name = batchOutputName(file.name, op, idx, '.png');
            });
            return saveItems(items).then(function (saved) {
              saved.forEach(function (r, idx) { if (r.ok && items[idx]) items[idx].path = r.path; });
              if (items[0]) results.push(items[0]);
              ok++;
              return items;
            }).catch(function () {
              fail++;
              return items;
            });
          }

          var task;
          if (local) {
            task = readImageAsync(file.uri, true).then(function (read) {
              setProgress('batch', '本地放大：' + (file.name || ''), pct + 2);
              return window.ImgTools.localUpscale(read.dataUri, window.Prompts.parseFactor(bv.factor), 4096).then(function (url) {
                return [{
                  url: url,
                  name: batchOutputName(file.name, op, 0, '.png'),
                  label: '本地无损放大 ' + (bv.factor || '')
                }];
              });
            });
          } else {
            var built = window.Prompts.build(op, bv);
            task = apiCallAsync('batch', built.prompt, bv.size, ratioFor(op, bv, image, built),
              file.uri ? [file.uri] : null)
              .then(function (res) { return postProcess(op, res, bv, image, built); })
              .then(function (out) { return out.items; });
          }

          task.then(function (items) { return afterItems(items); })
            .catch(function () { fail++; })
            .then(function () {
              done++;
              var p = Math.round(((i + 1) / files.length) * 100);
              setProgress('batch', '已完成 ' + (i + 1) + '/' + files.length + ' 张', p);
              step(i + 1);
            });
        }
        step(0);
      });
    }).then(function (out) {
      if (out && out.dry) return;
      var summary = '批量完成：成功 ' + out.ok + ' / 共 ' + out.total + ' 张' +
        (out.fail ? ('，失败 ' + out.fail + ' 张') : '') + '。文件已保存到相册 Download/AIPhotoStudio。';
      if (status) status.textContent = summary;
      showResult('batch', (out.results || []).slice(0, 8), null, summary);
      saveHistory('batch', out.results || [], '');
    }).catch(function (e) {
      showResultError('batch', e);
      if (status) status.textContent = '处理失败：' + e.message;
    }).then(function () {
      setBusy('batch', false);
      hideProgress('batch');
    });
  }

  // ---------- 导航 ----------
  var NAV_GROUPS = [
    { key: 'main', label: '证件照', ic: '🪪', ops: ['idphoto'] },
    { key: 'edit', label: '修图', ic: '✨', ops: ['background', 'retouch', 'restore', 'style'] },
    { key: 'create', label: '创作', ic: '🎨', ops: ['generate', 'outpaint', 'upscale', 'cutout', 'colorize', 'inpaint', 'product', 'avatar'] },
    { key: 'batch', label: '批量', ic: '📚', ops: ['batch'] },
    { key: 'history', label: '历史', ic: '🕘', ops: [] },
    { key: 'settings', label: '设置', ic: '⚙', ops: [] }
  ];
  var currentEdit = 'background';
  var currentCreate = 'generate';

  function setAppTitle(op, group) {
    var title = 'AI 照相馆';
    var sub = '让每一张照片都惊艳';
    if (group === 'main') { title = 'AI 证件照'; sub = '标准证件照 · 背景服装 · 冲印排版'; }
    else if (group === 'edit') {
      title = SCHEMA.labels[op] || '专业修图';
      sub = '人像精修 · 背景替换 · 老照片修复 · 风格写真';
    } else if (group === 'create') {
      title = SCHEMA.labels[op] || 'AI 创作';
      sub = '文生图 · 扩图 · 放大 · 抠图 · 上色 · 消除 · 商品图 · 头像';
    } else if (group === 'batch') { title = '批量处理'; sub = '文件夹批量生成 · 自动保存 · 支持 11 种操作'; }
    var t = document.getElementById('appTitle');
    var s = document.getElementById('appSub');
    if (t) t.textContent = title;
    if (s) s.textContent = sub;
  }

  function activatePanel(id) {
    var p = PANELS[id] || document.getElementById(id);
    if (p && p.classList) p.classList.add('active');
  }

  function switchGroup(key) {
    if (key === 'history') { openHistory(); return; }
    if (key === 'settings') { openSettings(); return; }
    currentGroup = key;
    qa('.nav-item', function (n) { if (n && n.classList) n.classList.toggle('active', n.dataset.group === key); });
    qa('.panel', function (p) { if (p && p.classList) p.classList.remove('active'); });
    if (key === 'main') {
      activatePanel('panel-main');
      currentOp = 'idphoto';
      setAppTitle(currentOp, key);
    } else if (key === 'edit') {
      activatePanel('panel-edit');
      switchSub(currentEdit);
    } else if (key === 'create') {
      activatePanel('panel-create');
      switchSub(currentCreate);
    } else if (key === 'batch') {
      activatePanel('panel-batch');
      currentOp = 'batch';
      setAppTitle('batch', key);
    }
    window.scrollTo(0, 0);
  }

  function switchSub(op) {
    currentOp = op;
    ensureSub(op);
    qa('.subtab', function (t) { if (t && t.classList) t.classList.toggle('active', t.dataset.op === op); });
    qa('.subview', function (v) { if (v && v.classList) v.classList.toggle('active', v.id === 'form-' + op); });
    setAppTitle(op, currentGroup);
    if (op === 'retouch') updateRetouchPreview(true);
  }

  // ---------- 初始化 ----------
  function init() {
    applyTheme(getStoredTheme());
    APP_CFG = native('getConfig') || APP_CFG;
    var main = document.getElementById('main');
    var nav = document.getElementById('bottomNav');

    // 主面板（证件照）
    var pMain = el('div', { class: 'panel active', id: 'panel-main' });
    PANELS['panel-main'] = pMain;
    pMain.appendChild(buildPanel('idphoto'));
    BUILT.idphoto = true;
    main.appendChild(pMain);
    refreshAllFilePreviews('idphoto');

    // 修图面板：子标签 + 懒加载
    var pEdit = el('div', { class: 'panel', id: 'panel-edit' });
    PANELS['panel-edit'] = pEdit;
    var editTabs = el('div', { class: 'subtabs' });
    NAV_GROUPS[1].ops.forEach(function (op, i) {
      var t = el('div', { class: 'subtab' + (i === 0 ? ' active' : ''), 'data-op': op, text: SCHEMA.icons[op] + ' ' + SCHEMA.labels[op] });
      t.onclick = function () { switchSub(op); };
      editTabs.appendChild(t);
    });
    pEdit.appendChild(editTabs);
    NAV_GROUPS[1].ops.forEach(function (op, i) {
      var sv = el('div', { class: 'subview' + (i === 0 ? ' active' : ''), id: 'form-' + op });
      sv.dataset.built = '0';
      pEdit.appendChild(sv);
    });
    main.appendChild(pEdit);

    // 创作面板：子标签 + 懒加载
    var pCreate = el('div', { class: 'panel', id: 'panel-create' });
    PANELS['panel-create'] = pCreate;
    var ct = el('div', { class: 'subtabs' });
    NAV_GROUPS[2].ops.forEach(function (op, i) {
      var t = el('div', { class: 'subtab' + (i === 0 ? ' active' : ''), 'data-op': op, text: SCHEMA.icons[op] + ' ' + SCHEMA.labels[op] });
      t.onclick = function () { switchSub(op); };
      ct.appendChild(t);
    });
    pCreate.appendChild(ct);
    NAV_GROUPS[2].ops.forEach(function (op, i) {
      var sv = el('div', { class: 'subview' + (i === 0 ? ' active' : ''), id: 'form-' + op });
      sv.dataset.built = '0';
      pCreate.appendChild(sv);
    });
    main.appendChild(pCreate);

    // 批量面板
    var pBatch = el('div', { class: 'panel', id: 'panel-batch' });
    PANELS['panel-batch'] = pBatch;
    var batchBody = buildPanel('batch');
    var dyn = el('div', { id: 'batchDynamic' });
    batchBody.insertBefore(dyn, batchBody.lastChild);
    pBatch.appendChild(batchBody);
    main.appendChild(pBatch);
    BUILT.batch = true;
    refreshAllFilePreviews('batch');

    // 底部导航
    NAV_GROUPS.forEach(function (g, i) {
      var b = el('button', { class: 'nav-item' + (i === 0 ? ' active' : ''), 'data-group': g.key });
      b.appendChild(el('span', { class: 'ic', text: g.ic }));
      b.appendChild(el('span', { text: g.label }));
      b.onclick = function () { switchGroup(g.key); };
      nav.appendChild(b);
    });

    // 主题按钮
    qa('#themeSeg button', function (b) {
      b.onclick = function () { setTheme(b.dataset.theme); };
    });
    // 点击遮罩关闭
    ['settingsSheet', 'historySheet'].forEach(function (id) {
      var mask = document.getElementById(id);
      if (mask) mask.onclick = function (e) { if (e.target === mask) mask.style.display = 'none'; };
    });

    renderBatchDynamic();
    setAppTitle('idphoto', 'main');

    var bm = document.getElementById('bootMsg');
    if (bm && bm.parentNode) bm.parentNode.removeChild(bm);
    if (window.__bootCheck) { clearTimeout(window.__bootCheck); window.__bootCheck = null; }
  }

  window.switchGroup = switchGroup;
  window.switchSub = switchSub;
  window.refreshTheme = function () { applyTheme(getStoredTheme()); };

  window.handleBack = function () {
    var lb = document.getElementById('lightbox');
    if (lb && lb.style.display === 'flex') { window.closeLightbox(); return true; }
    var hs = document.getElementById('historySheet');
    if (hs && hs.style.display === 'block') { window.closeHistory(); return true; }
    var ss = document.getElementById('settingsSheet');
    if (ss && ss.style.display === 'block') { window.closeSettings(); return true; }
    return false;
  };

  window.onerror = function (msg, src, line, col) {
    showError(String(msg) + ' @ ' + line + ':' + col);
    return false;
  };

  try { init(); }
  catch (e) {
    showError('初始化错误：' + e.message + '\n' + (e.stack || ''));
  }
})();
