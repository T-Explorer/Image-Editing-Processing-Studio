/* 图像处理（Canvas）：等比裁剪、证件照规格化、多规格冲印排版 */
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
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(resized, Math.floor((w-targetW)/2), Math.floor((h-targetH)/2),
        targetW, targetH, 0, 0, targetW, targetH);
      return canvasToPng(canvas);
    });
  }

  /** 多规格冲印排版。info={w,h,count,label}。count<=0 表示铺满。 */
  function makeSheet(src, photoW, photoH, info) {
    info = info || {w:1795,h:1205,count:0,label:'6寸相纸'};
    var sheetW=info.w, sheetH=info.h, count=info.count||0;
    return loadImage(src).then(function (img) {
      var gap = sheetW>2000 ? 24 : 20;
      var margin = sheetW>2000 ? 40 : 30;
      var photo = document.createElement('canvas');
      photo.width=photoW; photo.height=photoH;
      photo.getContext('2d').drawImage(img,0,0,photoW,photoH);
      // 先计算最大可排数量
      var usableW=sheetW-2*margin, usableH=sheetH-2*margin;
      var cols=Math.max(1,Math.floor((usableW+gap)/(photoW+gap)));
      var rows=Math.max(1,Math.floor((usableH+gap)/(photoH+gap)));
      var max=cols*rows;
      var total = count>0 ? Math.min(count,max) : max;
      // 若指定张数试图更紧凑排布（尽量接近正方形网格）
      if (count>0 && count<max) {
        var best=null;
        for (var c=1;c<=count;c++){
          var r=Math.ceil(count/c);
          if (c*photoW+(c-1)*gap<=usableW && r*photoH+(r-1)*gap<=usableH){
            var score=Math.abs(c-r);
            if(!best||score<best.score) best={cols:c,rows:r,score:score};
          }
        }
        if(best){cols=best.cols;rows=best.rows;}
      }
      var gridW=cols*photoW+(cols-1)*gap;
      var gridH=rows*photoH+(rows-1)*gap;
      var startX=Math.floor((sheetW-gridW)/2);
      var startY=Math.floor((sheetH-gridH)/2);
      var canvas=document.createElement('canvas');
      canvas.width=sheetW; canvas.height=sheetH;
      var ctx=canvas.getContext('2d');
      ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,sheetW,sheetH);
      for (var i=0;i<total;i++){
        var col=i%cols, row=Math.floor(i/cols);
        ctx.drawImage(photo, startX+col*(photoW+gap), startY+row*(photoH+gap));
      }
      return canvasToPng(canvas);
    });
  }

  /** 人像精修参数强度可视化预览（本地示意，非AI生成）。 */
  function previewRetouch(src, v) {
    return loadImage(src).then(function (img) {
      var w=img.width, h=img.height;
      var canvas=document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      var ctx=canvas.getContext('2d');
      var smooth=(parseInt(v.smooth)||0)/100;
      var bright=(parseInt(v.brighten)||0)/100;
      var slim=(parseInt(v.slim)||0)/100;
      ctx.filter='blur('+(smooth*1.2).toFixed(2)+'px) brightness('+(1+bright*0.12).toFixed(2)+') contrast('+(1+smooth*0.05).toFixed(2)+')';
      ctx.drawImage(img,0,0,w,h);
      ctx.filter='none';
      // 轻微瘦脸：中间区域横向压缩的示意（局部近似）
      if (slim>0.05) {
        var tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
        var tctx=tmp.getContext('2d'); tctx.drawImage(canvas,0,0);
        ctx.clearRect(0,0,w,h);
        var fx=w*0.22, fw=w*0.56, sx=slim*0.06;
        ctx.drawImage(tmp,0,0,fx,h,0,0,fx,h);
        ctx.drawImage(tmp,fx,0,fw,h,fx+fw*sx,0,fw*(1-2*sx),h);
        ctx.drawImage(tmp,fx+fw,0,w-fx-fw,h,fx+fw,0,w-fx-fw,h);
      }
      return canvasToPng(canvas);
    });
  }

  /** 生成历史缩略图（小尺寸 data URI），节省存储。 */
  function makeThumb(src, w, h){
    w=w||180; h=h||240;
    return loadImage(src).then(function(img){
      var scale=Math.min(w/img.width,h/img.height);
      var tw=Math.max(1,Math.round(img.width*scale)), th=Math.max(1,Math.round(img.height*scale));
      var c=document.createElement('canvas'); c.width=tw; c.height=th;
      var ctx=c.getContext('2d'); ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,tw,th);
      ctx.drawImage(img,0,0,tw,th);
      return c.toDataURL('image/jpeg',0.6);
    });
  }

  global.ImgTools={ loadImage:loadImage, fitToCanvas:fitToCanvas,
    makeSheet:makeSheet, previewRetouch:previewRetouch, makeThumb:makeThumb };
})(window);
