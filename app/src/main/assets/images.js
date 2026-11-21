/* 图像处理（Canvas）：裁剪、排版、无损放大、透明抠图、精修实时预览、历史缩略图 */
(function (global) {
  'use strict';

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片解码失败')); };
      img.src = src;
    });
  }
  function canvasToPng(canvas) { return canvas.toDataURL('image/png'); }
  function canvasToJpeg(canvas, q) { return canvas.toDataURL('image/jpeg', q || 0.82); }

  /** 按 cover / contain 方式缩放并居中，支持透明或指定底色。 */
  function fitToCanvas(src, targetW, targetH, opts) {
    opts = opts || {};
    return loadImage(src).then(function (img) {
      var mode = opts.mode || 'cover';
      var scale = mode === 'contain'
        ? Math.min(targetW / img.width, targetH / img.height)
        : Math.max(targetW / img.width, targetH / img.height);
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var resized = document.createElement('canvas');
      resized.width = w; resized.height = h;
      var rctx = resized.getContext('2d');
      rctx.imageSmoothingEnabled = true;
      rctx.imageSmoothingQuality = 'high';
      rctx.drawImage(img, 0, 0, w, h);
      var canvas = document.createElement('canvas');
      canvas.width = targetW; canvas.height = targetH;
      var ctx = canvas.getContext('2d');
      if (!opts.transparent) {
        ctx.fillStyle = opts.fill || '#FFFFFF';
        ctx.fillRect(0, 0, targetW, targetH);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(resized, Math.round((targetW - w) / 2), Math.round((targetH - h) / 2));
      return opts.jpeg ? canvasToJpeg(canvas, opts.quality) : canvasToPng(canvas);
    });
  }

  function ratioValue(ratio) {
    var p = String(ratio || '1:1').split(':');
    var a = parseFloat(p[0]) || 1, b = parseFloat(p[1]) || 1;
    return a / b;
  }

  /** 按画幅比例输出，默认 contain 不裁切主体。 */
  function fitToRatio(src, ratio, opts) {
    opts = opts || {};
    var r = ratioValue(ratio);
    var max = opts.maxSize || 2048;
    var w, h;
    if (r >= 1) { w = max; h = Math.round(max / r); }
    else { h = max; w = Math.round(max * r); }
    return fitToCanvas(src, w, h, {
      mode: opts.mode || 'contain',
      fill: opts.fill || '#FFFFFF',
      transparent: !!opts.transparent
    });
  }

  function upscaleDims(w, h, factor, cap) {
    cap = cap || 8192;
    var f = Math.max(1, parseFloat(factor) || 1);
    var tw = Math.round(w * f), th = Math.round(h * f);
    var max = Math.max(tw, th);
    if (max > cap) {
      var s = cap / max;
      tw = Math.max(1, Math.round(tw * s));
      th = Math.max(1, Math.round(th * s));
    }
    return { w: tw, h: th };
  }

  /** 本地高质量放大：分步 2 倍缩放，避免一次性拉伸的模糊与锯齿。 */
  function resizeTo(src, targetW, targetH) {
    return loadImage(src).then(function (img) {
      var cur = document.createElement('canvas');
      cur.width = img.width; cur.height = img.height;
      cur.getContext('2d').drawImage(img, 0, 0);
      var cw = img.width, ch = img.height;
      while (cw * 2 < targetW && ch * 2 < targetH) {
        var next = document.createElement('canvas');
        next.width = cw * 2; next.height = ch * 2;
        var nctx = next.getContext('2d');
        nctx.imageSmoothingEnabled = true;
        nctx.imageSmoothingQuality = 'high';
        nctx.drawImage(cur, 0, 0, next.width, next.height);
        cur = next; cw = next.width; ch = next.height;
      }
      var out = document.createElement('canvas');
      out.width = targetW; out.height = targetH;
      var octx = out.getContext('2d');
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(cur, 0, 0, targetW, targetH);
      return canvasToPng(out);
    });
  }

  function localUpscale(src, factor, cap) {
    return loadImage(src).then(function (img) {
      var d = upscaleDims(img.width, img.height, factor, cap || 4096);
      return resizeTo(src, d.w, d.h);
    });
  }

  /**
   * 把纯色背景抠成透明：从四边泛洪填充，保留主体内部的同色区域。
   * opts.tolerance 颜色容差（默认 46），opts.feather 边缘羽化（默认 2）。
   */
  function removeBackgroundToTransparent(src, opts) {
    opts = opts || {};
    var tol = opts.tolerance || 46;
    var feather = opts.feather === undefined ? 2 : opts.feather;
    var maxEdge = opts.maxEdge || 1600;
    return loadImage(src).then(function (img) {
      var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var imageData = ctx.getImageData(0, 0, w, h);
      var data = imageData.data;

      // 1. 统计四边颜色，取出现最多的量化颜色作为背景色
      var hist = {}, bestKey = null, bestCount = 0;
      function borderSample(x, y) {
        var i = (y * w + x) * 4;
        if (data[i + 3] < 16) return;
        var key = (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4);
        hist[key] = (hist[key] || 0) + 1;
        if (hist[key] > bestCount) { bestCount = hist[key]; bestKey = key; }
      }
      for (var x = 0; x < w; x += 2) { borderSample(x, 0); borderSample(x, h - 1); }
      for (var y = 0; y < h; y += 2) { borderSample(0, y); borderSample(w - 1, y); }
      var bg = [255, 255, 255];
      if (bestKey) {
        var p = bestKey.split(',');
        bg = [parseInt(p[0], 10) * 16 + 8, parseInt(p[1], 10) * 16 + 8, parseInt(p[2], 10) * 16 + 8];
      }

      function dist(i) {
        var dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
        return Math.sqrt(dr * dr + dg * dg + db * db);
      }

      // 2. 从边缘泛洪，只去掉与边缘连通的背景；接近主体边缘时停止，避免吃掉发丝
      var visited = new Uint8Array(w * h);
      var stack = new Int32Array(w * h);
      var sp = 0;
      function nearSubject(i, cx, cy) {
        for (var ox = -3; ox <= 3; ox++) {
          var nx = cx + ox;
          if (nx < 0 || nx >= w) continue;
          for (var oy = -3; oy <= 3; oy++) {
            var ny = cy + oy;
            if (ny < 0 || ny >= h) continue;
            var j = (ny * w + nx) * 4;
            if (data[j + 3] >= 200 && dist(j) > Math.max(tol, 110)) return true;
          }
        }
        return false;
      }
      function push(idx, cx, cy) {
        if (visited[idx]) return;
        var i = idx * 4;
        if (data[i + 3] < 16 || dist(i) <= tol) {
          if (!nearSubject(i, cx, cy)) {
            visited[idx] = 1;
            stack[sp++] = idx;
          }
        }
      }
      for (var bx = 0; bx < w; bx++) { push(bx, bx, 0); push((h - 1) * w + bx, bx, h - 1); }
      for (var by = 0; by < h; by++) { push(by * w, 0, by); push(by * w + w - 1, w - 1, by); }
      while (sp > 0) {
        var idx = stack[--sp];
        var cx = idx % w, cy = (idx / w) | 0;
        if (cx > 0) push(idx - 1, cx - 1, cy);
        if (cx < w - 1) push(idx + 1, cx + 1, cy);
        if (cy > 0) push(idx - w, cx, cy - 1);
        if (cy < h - 1) push(idx + w, cx, cy + 1);
      }
      for (var i2 = 0; i2 < visited.length; i2++) {
        if (visited[i2]) data[i2 * 4 + 3] = 0;
      }

      // 3. 轻微羽化：只降低已透明边缘外侧 1px 的不透明度，不把头发主体削薄
      if (feather > 0) {
        var alphaCopy = new Uint8Array(w * h);
        for (var a = 0; a < alphaCopy.length; a++) alphaCopy[a] = data[a * 4 + 3];
        for (var yy = 0; yy < h; yy++) {
          for (var xx = 0; xx < w; xx++) {
            var id = yy * w + xx;
            if (alphaCopy[id] === 0) continue;
            var near = false;
            if (xx > 0 && alphaCopy[id - 1] === 0) near = true;
            else if (xx < w - 1 && alphaCopy[id + 1] === 0) near = true;
            else if (yy > 0 && alphaCopy[id - w] === 0) near = true;
            else if (yy < h - 1 && alphaCopy[id + w] === 0) near = true;
            if (near) data[id * 4 + 3] = Math.min(data[id * 4 + 3], 210);
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return canvasToPng(canvas);
    });
  }

  /** 人像精修实时预览（本地示意，不调用 AI）。max 控制预览尺寸以保证流畅。 */
  function previewRetouch(src, v, opts) {
    opts = opts || {};
    var max = opts.max || 520;
    return loadImage(src).then(function (img) {
      var scale = Math.min(1, max / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');

      var smooth = (parseInt(v.smooth, 10) || 0) / 100;
      var acne = (parseInt(v.acne, 10) || 0) / 100;
      var bright = (parseInt(v.brighten, 10) || 0) / 100;
      var slim = (parseInt(v.slim, 10) || 0) / 100;
      var eyes = (parseInt(v.eyes, 10) || 0) / 100;
      var teeth = (parseInt(v.teeth, 10) || 0) / 100;
      var oil = v.oil ? 1 : 0;

      var blur = smooth * 1.7 + acne * 0.9;
      var brightness = 1 + bright * 0.12 + teeth * 0.03 + eyes * 0.015 - oil * 0.015;
      var contrast = 1 + smooth * 0.04 + eyes * 0.05;
      var saturate = 1 + bright * 0.04 - oil * 0.03;
      ctx.filter = 'blur(' + blur.toFixed(2) + 'px) brightness(' + brightness.toFixed(3) +
        ') contrast(' + contrast.toFixed(3) + ') saturate(' + saturate.toFixed(3) + ')';
      ctx.drawImage(img, 0, 0, w, h);
      ctx.filter = 'none';

      // 轻微瘦脸：中间面部区域横向压缩，两侧同步拉伸填满，避免出现透明竖条
      if (slim > 0.03) {
        var tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
        tmp.getContext('2d').drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, w, h);
        var fx = w * 0.20, fw = w * 0.60, sx = slim * 0.055;
        var newW = fw * (1 - 2 * sx);
        var nx = fx + (fw - newW) / 2;
        ctx.drawImage(tmp, 0, 0, fx, h, 0, 0, nx, h);
        ctx.drawImage(tmp, fx, 0, fw, h, nx, 0, newW, h);
        ctx.drawImage(tmp, fx + fw, 0, w - fx - fw, h, nx + newW, 0, w - nx - newW, h);
      }

      // 背景虚化：中心人物保持清晰
      if (v.bg_blur) {
        var blurCanvas = document.createElement('canvas'); blurCanvas.width = w; blurCanvas.height = h;
        var bctx = blurCanvas.getContext('2d');
        bctx.filter = 'blur(' + Math.max(2, Math.round(w / 80)) + 'px)';
        bctx.drawImage(canvas, 0, 0);
        bctx.filter = 'none';
        var mask = document.createElement('canvas'); mask.width = w; mask.height = h;
        var mctx = mask.getContext('2d');
        mctx.drawImage(blurCanvas, 0, 0);
        var g = mctx.createRadialGradient(w * 0.5, h * 0.42, Math.min(w, h) * 0.22,
          w * 0.5, h * 0.42, Math.max(w, h) * 0.62);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0.95)');
        mctx.globalCompositeOperation = 'destination-in';
        mctx.fillStyle = g;
        mctx.fillRect(0, 0, w, h);
        ctx.drawImage(mask, 0, 0);
      }
      return canvasToPng(canvas);
    });
  }

  /** 生成历史缩略图（小尺寸 data URI），节省存储。opts.transparent 保留透明背景。 */
  function makeThumb(src, w, h, opts) {
    opts = opts || {};
    w = w || 180; h = h || 240;
    return loadImage(src).then(function (img) {
      var scale = Math.min(w / img.width, h / img.height);
      var tw = Math.max(1, Math.round(img.width * scale));
      var th = Math.max(1, Math.round(img.height * scale));
      var c = document.createElement('canvas'); c.width = tw; c.height = th;
      var ctx = c.getContext('2d');
      if (!opts.transparent) {
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, tw, th);
      }
      ctx.drawImage(img, 0, 0, tw, th);
      return opts.transparent ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.62);
    });
  }

  /** 历史预览图（较大但仍压缩），用于点击查看。opts.transparent 保留透明背景。 */
  function makePreview(src, maxEdge, quality, opts) {
    opts = opts || {};
    maxEdge = maxEdge || 760;
    return loadImage(src).then(function (img) {
      var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      if (!opts.transparent) {
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);
      return opts.transparent ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality || 0.78);
    });
  }

  global.ImgTools = {
    loadImage: loadImage,
    fitToCanvas: fitToCanvas,
    fitToRatio: fitToRatio,
    makeSheet: makeSheet,
    previewRetouch: previewRetouch,
    makeThumb: makeThumb,
    makePreview: makePreview,
    localUpscale: localUpscale,
    resizeTo: resizeTo,
    upscaleDims: upscaleDims,
    removeBackgroundToTransparent: removeBackgroundToTransparent
  };

  /** 多规格冲印排版。info={w,h,count,label}。count<=0 表示铺满。 */
  function makeSheet(src, photoW, photoH, info) {
    info = info || { w: 1795, h: 1205, count: 0, label: '6寸相纸' };
    var sheetW = info.w, sheetH = info.h, count = info.count || 0;
    return loadImage(src).then(function (img) {
      var gap = sheetW > 2000 ? 24 : 20;
      var margin = sheetW > 2000 ? 40 : 30;
      var photo = document.createElement('canvas');
      photo.width = photoW; photo.height = photoH;
      photo.getContext('2d').drawImage(img, 0, 0, photoW, photoH);
      var usableW = sheetW - 2 * margin, usableH = sheetH - 2 * margin;
      var cols = Math.max(1, Math.floor((usableW + gap) / (photoW + gap)));
      var rows = Math.max(1, Math.floor((usableH + gap) / (photoH + gap)));
      var max = cols * rows;
      var total = count > 0 ? Math.min(count, max) : max;
      if (count > 0 && count < max) {
        var best = null;
        for (var c = 1; c <= count; c++) {
          var r = Math.ceil(count / c);
          if (c * photoW + (c - 1) * gap <= usableW && r * photoH + (r - 1) * gap <= usableH) {
            var score = Math.abs(c - r);
            if (!best || score < best.score) best = { cols: c, rows: r, score: score };
          }
        }
        if (best) { cols = best.cols; rows = best.rows; }
      }
      var gridW = cols * photoW + (cols - 1) * gap;
      var gridH = rows * photoH + (rows - 1) * gap;
      var startX = Math.floor((sheetW - gridW) / 2);
      var startY = Math.floor((sheetH - gridH) / 2);
      var canvas = document.createElement('canvas');
      canvas.width = sheetW; canvas.height = sheetH;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, sheetW, sheetH);
      for (var i = 0; i < total; i++) {
        var col = i % cols, row = Math.floor(i / cols);
        ctx.drawImage(photo, startX + col * (photoW + gap), startY + row * (photoH + gap));
      }
      return canvasToPng(canvas);
    });
  }
})(window);
