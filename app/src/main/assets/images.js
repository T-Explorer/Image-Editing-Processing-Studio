/* 图像处理（Canvas）：等比裁剪、证件照规格化、6 寸排版 */
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

  function canvasToPng(canvas) {
    return canvas.toDataURL('image/png');
  }

  /** 按 cover 方式缩放并居中裁切到目标尺寸，避免拉伸。 */
  function fitToCanvas(src, targetW, targetH) {
    return loadImage(src).then(function (img) {
      var scale = Math.max(targetW / img.width, targetH / img.height);
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var resized = document.createElement('canvas');
      resized.width = w; resized.height = h;
      resized.getContext('2d').drawImage(img, 0, 0, w, h);

      var canvas = document.createElement('canvas');
      canvas.width = targetW; canvas.height = targetH;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
      var left = Math.floor((w - targetW) / 2);
      var top = Math.floor((h - targetH) / 2);
      ctx.drawImage(resized, left, top, targetW, targetH, 0, 0, targetW, targetH);
      return canvasToPng(canvas);
    });
  }

  /** 6 寸相纸：1795×1205 @300dpi 排版证件照。count<=0 表示铺满。 */
  function makeSheet(src, photoW, photoH, count) {
    return loadImage(src).then(function (img) {
      var SHEET_W = 1795, SHEET_H = 1205, gap = 30, margin = 36;
      var usableW = SHEET_W - 2 * margin;
      var usableH = SHEET_H - 2 * margin;
      var cols = Math.max(1, Math.floor((usableW + gap) / (photoW + gap)));
      var rows = Math.max(1, Math.floor((usableH + gap) / (photoH + gap)));
      var max = cols * rows;
      var total = (!count || count <= 0) ? max : Math.min(parseInt(count) || 0, max);

      var photo = document.createElement('canvas');
      photo.width = photoW; photo.height = photoH;
      photo.getContext('2d').drawImage(img, 0, 0, photoW, photoH);

      var canvas = document.createElement('canvas');
      canvas.width = SHEET_W; canvas.height = SHEET_H;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, SHEET_W, SHEET_H);

      var gridW = cols * photoW + (cols - 1) * gap;
      var gridH = rows * photoH + (rows - 1) * gap;
      var startX = Math.floor((SHEET_W - gridW) / 2);
      var startY = Math.floor((SHEET_H - gridH) / 2);
      for (var i = 0; i < total; i++) {
        var col = i % cols, row = Math.floor(i / cols);
        ctx.drawImage(photo,
          startX + col * (photoW + gap),
          startY + row * (photoH + gap));
      }
      return canvasToPng(canvas);
    });
  }

  function dataUrlToBase64(dataUrl) {
    var i = dataUrl.indexOf(',');
    return i >= 0 ? dataUrl.substring(i + 1) : dataUrl;
  }

  global.ImgTools = {
    loadImage: loadImage,
    fitToCanvas: fitToCanvas,
    makeSheet: makeSheet,
    dataUrlToBase64: dataUrlToBase64
  };
})(window);
