/* AI 照相馆 Android 主逻辑 v2.1 —— 分组布局 / 异步进度 / 历史 / 大图预览 */
(function () {
  'use strict';
  var SCHEMA = window.APP_SCHEMA || {ops:{},labels:{},icons:{},tags:{}};
  var state = {}, currentOp = 'idphoto';
  var THEME_KEY = 'theme_mode';

  window.onerror = function (msg, src, line, col) {
    try {
      var m = document.getElementById('main');
      if (m) m.innerHTML = '<div class="card" style="border-color:#B3261E"><h2 style="color:#B3261E">⚠️ 脚本错误</h2><pre style="white-space:pre-wrap">' + String(msg) + ' @ ' + line + ':' + col + '</pre></div>';
    } catch (e) {}
    return false;
  };
  function qa(sel, fn, root) {
    var r = root || document, nodes = r.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }
  state.batch = state.batch || {};

  function native(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      var raw = window.Android[method].apply(window.Android, args);
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) { return {ok:false,error:method+': '+e.message}; }
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function(k){
      var v=attrs[k];
      if(k==='class') n.className=v;
      else if(k==='text') n.textContent=v;
      else if(k==='html') n.innerHTML=v;
      else if(k.slice(0,2)==='on') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k,v);
    });
    (children||[]).forEach(function(c){ if(c) n.appendChild(c); });
    return n;
  }
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  // ---------- 主题 ----------
  function applyTheme(mode){
    var dark = mode==='dark';
    if(mode==='system'){
      try{ if(window.Android&&window.Android.getSystemTheme) dark=window.Android.getSystemTheme()==='dark'; }catch(e){}
      if(!window.Android&&window.matchMedia) dark=window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    try{
      document.documentElement.setAttribute('data-theme',dark?'dark':'light');
      var mt=document.querySelector('meta[name=theme-color]');
      if(mt) mt.setAttribute('content',dark?'#1B1B24':'#6750A4');
    }catch(e){}
  }
  function getStoredTheme(){ try{return localStorage.getItem(THEME_KEY)||'system';}catch(e){return 'system';} }

  // ---------- 字段渲染 ----------
  function fieldNode(op, f){
    if(!state[op]) state[op]={};
    var wrap=el('div',{class:'field'+(['textarea','file','dir','stylegrid','example','color'].indexOf(f.type)>=0?' wide':'')});
    if(f.type==='boolopt'||f.type==='bool_true'){
      var box=el('input',{type:'checkbox'}); box.checked=!!f.default;
      box.dataset.key=f.key; box.dataset.type=f.type;
      return el('label',{class:'check'},[box,document.createTextNode(f.label)]);
    }
    if(f.type==='stylegrid'){
      wrap.appendChild(el('label',{text:f.label}));
      var grid=el('div',{class:'style-grid'}); var opts=f.options||[];
      opts.forEach(function(item){
        var o=(typeof item==='object')?item:{label:item,desc:'',emoji:''};
        var card=el('div',{class:'style-card'+(o.label===f.default?' active':'')});
        card.dataset.value=o.label;
        card.appendChild(el('span',{class:'em',text:o.emoji||'✨'}));
        card.appendChild(el('span',{class:'nm',text:o.label}));
        if(o.desc) card.appendChild(el('span',{class:'ds',text:o.desc}));
        card.onclick=function(){
          var cards=grid.querySelectorAll('.style-card');
          for(var i=0;i<cards.length;i++)cards[i].classList.remove('active');
          card.classList.add('active'); state[op][f.key]=o.label;
        };
        grid.appendChild(card);
      });
      state[op][f.key]=f.default; wrap.appendChild(grid); return wrap;
    }
    if(f.type==='color'){
      wrap.appendChild(el('label',{text:f.label}));
      var row=el('div',{class:'color-row'});
      var picker=el('input',{type:'color',value:/^#[0-9a-fA-F]{6}$/.test(f.default)?f.default:'#438EDB'});
      var text=el('input',{type:'text',value:f.default||'#438EDB',placeholder:'#RRGGBB'});
      picker.oninput=function(){text.value=picker.value;state[op][f.key]=picker.value;};
      text.oninput=function(){if(/^#[0-9a-fA-F]{6}$/.test(text.value)){picker.value=text.value;state[op][f.key]=text.value;}};
      state[op][f.key]=f.default||'#438EDB';
      row.appendChild(picker); row.appendChild(text); wrap.appendChild(row);
      var sw=el('div',{class:'swatches'});
      ['#FFFFFF','#438EDB','#1F4E79','#D9001B','#EDEDED','#F5F1E8','#4CAF50','#FF9800','#9C27B0','#00BCD4','#3F51B5','#000000'].forEach(function(c){
        var sb=el('div',{class:'swatch'}); sb.style.background=c; sb.title=c;
        sb.onclick=function(){picker.value=c;text.value=c;state[op][f.key]=c;}; sw.appendChild(sb);
      });
      wrap.appendChild(sw); return wrap;
    }
    wrap.appendChild(el('label',{text:f.label}));
    var input;
    if(f.type==='select'){
      input=el('select',{});
      (f.options||[]).forEach(function(item){
        var o=(typeof item==='object')?item:{label:item,value:item};
        input.appendChild(el('option',{value:o.value!==undefined?o.value:o.label,text:o.label}));
      });
      input.value=f.default||'';
    } else if(f.type==='textarea'||f.type==='example'){
      input=el('textarea',{placeholder:f.help||''}); input.value=f.default||'';
    } else if(f.type==='range'){
      input=el('input',{type:'range'}); var meta=f.meta||{};
      input.min=meta.min!==undefined?meta.min:0; input.max=meta.max!==undefined?meta.max:100;
      input.value=f.default;
      var rv=el('span',{class:'range-val',text:String(f.default)});
      var livePv=el('img',{alt:'实时预览'});
      var previewBox=el('div',{class:'range-preview'}); previewBox.style.display='none';
      previewBox.appendChild(livePv);
      var tmr=null;
      input.oninput=function(){
        rv.textContent=input.value;
        if(op==='retouch'&&state[op].image&&state[op].image.dataUri){
          if(tmr) clearTimeout(tmr);
          tmr=setTimeout(function(){
            window.ImgTools.previewRetouch(state[op].image.dataUri,collectRaw(op)).then(function(out){
              livePv.src=out; previewBox.style.display='flex';
            }).catch(function(){});
          },180);
        }
      };
      var rangeRow=el('div',{class:'range-row'},[input,rv]);
      wrap.appendChild(rangeRow); wrap.appendChild(previewBox);
      input.dataset.key=f.key; input.dataset.type='range';
      return wrap;
    } else if(f.type==='file'){
      input=el('button',{class:'btn ghost small',type:'button',text:'📷 选择图片 / 拍照'});
      input.onclick=function(){ state[op][f.key]=null; native('pickImage'); };
    } else if(f.type==='dir'){
      input=el('button',{class:'btn ghost small',type:'button',text:'📁 选择文件夹'});
      input.onclick=function(){ native('pickFolder'); };
    } else {
      input=el('input',{type:f.type==='number'?'number':'text',placeholder:f.help||''});
      input.value=f.default!=null?f.default:'';
    }
    input.dataset.key=f.key; input.dataset.type=f.type;
    if(f.type==='example'&&f.example){
      var eb=el('button',{class:'example-btn',text:'填入示例'});
      eb.onclick=function(){ input.value=f.example; };
      var box=el('div',{class:'example-box'},[input,eb]); wrap.appendChild(box);
    } else wrap.appendChild(input);
    if(f.type==='file'){
      var pv=el('img',{class:'picked',alt:'预览'}); pv.id='preview_'+op+'_'+f.key; wrap.appendChild(pv);
    }
    if(f.type==='dir'){
      wrap.appendChild(el('div',{class:'hint',id:'folder_'+op+'_'+f.key,text:'未选择文件夹'}));
    }
    if(f.help&&['textarea','example','file','dir'].indexOf(f.type)<0){
      wrap.appendChild(el('div',{class:'hint',text:f.help}));
    }
    return wrap;
  }

  function buildGroups(op, groups){
    var host=document.createDocumentFragment();
    groups.forEach(function(g){
      var card=el('div',{class:'card'});
      card.appendChild(el('h2',{},[document.createTextNode(g.icon+'  '+g.title)]));
      var grid=el('div',{class:'grid'});
      g.fields.forEach(function(f){ grid.appendChild(fieldNode(op,f)); });
      card.appendChild(grid); host.appendChild(card);
    });
    return host;
  }

  function makeAction(op, isBatch){
    var box=el('div',{class:'card'});
    if(op==='retouch'){
      var bigPv=el('div',{class:'range-preview',style:'display:none',id:'bigPreview_'+op});
      bigPv.appendChild(el('img',{id:'bigPreviewImg_'+op,alt:'实时预览'}));
      box.appendChild(bigPv);
    }
    var btn=el('button',{class:'btn',type:'button',text:isBatch?'开始批量处理':'✨ 开始生成'});
    btn.onclick=function(){ isBatch?runBatch():run(op); };
    box.appendChild(btn);
    var pr=el('div',{class:'progress',id:'progress_'+op});
    pr.appendChild(el('div',{class:'track'},[el('div',{class:'fill',id:'progressFill_'+op})]));
    pr.appendChild(el('div',{class:'txt',id:'progressTxt_'+op}));
    box.appendChild(pr);
    box.appendChild(el('div',{id:'result_'+op}));
    return box;
  }

  // 导航分组
  var NAV_GROUPS = [
    {key:'main',label:'证件照',ic:'🪪',ops:['idphoto']},
    {key:'edit',label:'修图',ic:'✨',ops:['background','retouch','restore','style']},
    {key:'create',label:'创作',ic:'🎨',ops:['generate','outpaint','upscale','cutout','colorize','inpaint','product','avatar']},
    {key:'batch',label:'批量',ic:'📚',ops:['batch']},
    {key:'history',label:'历史',ic:'🕘',ops:[]},
    {key:'settings',label:'设置',ic:'⚙',ops:[]}
  ];

  function buildPanel(op){
    var def=SCHEMA.ops[op], wrap=el('section',{class:'subview',id:'form-'+op});
    wrap.appendChild(buildGroups(op, def.groups));
    if(op==='upscale'){
      var note=el('div',{class:'card'});
      note.appendChild(el('div',{class:'hint',text:'提示：高清放大通过重绘增强细节实现，会尽量保持原图内容与构图。'}));
      wrap.appendChild(note);
    }
    wrap.appendChild(makeAction(op, op==='batch'));
    return wrap;
  }

  // ---------- 表单收集 ----------
  function collectRaw(op){
    var values={};
    qa('#form-'+op+' [data-key]', function(node){
      var k=node.dataset.key,t=node.dataset.type;
      if(t==='bool_true'||t==='boolopt') values[k]=node.checked;
      else if(t==='range') values[k]=parseInt(node.value);
      else values[k]=node.value;
    });
    qa('#form-'+op+' .style-card.active', function(n){});
    // stylegrid
    var def=SCHEMA.ops[op];
    (def.groups||[]).forEach(function(g){ g.fields.forEach(function(f){
      if(f.type==='stylegrid'&&state[op][f.key]) values[f.key]=state[op][f.key];
      if(f.type==='color'&&state[op][f.key]) values[f.key]=state[op][f.key];
    });});
    return values;
  }

  // ---------- 原生回调 ----------
  window.onImagePicked=function(json){
    var r=typeof json==='string'?JSON.parse(json):json;
    if(!r.ok){alert('选择图片失败：'+r.error);return;}
    var key=(currentOp==='generate'||currentOp==='product')?'reference':'image';
    state[currentOp]=state[currentOp]||{}; state[currentOp][key]=r;
    var pv=document.getElementById('preview_'+currentOp+'_'+key);
    if(pv){pv.src=r.dataUri;pv.style.display='block';
      pv.parentNode.appendChild(el('div',{class:'hint',text:'📐 '+r.width+'×'+r.height}));}
  };
  window.onFolderPicked=function(json){
    var r=typeof json==='string'?JSON.parse(json):json;
    if(!r.ok){alert('选择文件夹失败：'+r.error);return;}
    state.batch=state.batch||{}; state.batch.folderUri=r.uri;
    var lab=document.getElementById('folder_batch_input_dir');
    if(lab) lab.textContent=r.uri;
  };

  // 异步 API 回调
  var _apiResolve={};
  window.__apiProgress=function(id,text,pct){
    var f=document.getElementById('progressFill_'+id), t=document.getElementById('progressTxt_'+id);
    var pr=document.querySelector('#form-'+id+' .progress');
    if(pr) pr.style.display='block';
    if(f) f.style.width=pct+'%'; if(t) t.textContent=text+'（'+pct+'%）';
  };
  window.__apiResult=function(id,res){
    var pr=document.querySelector('#form-'+id+' .progress'); if(pr) pr.style.display='none';
    var cb=_apiResolve[id]; if(cb){delete _apiResolve[id]; cb(res);}
  };

  function apiCallAsync(id, prompt, size, ratio, uris){
    return new Promise(function(resolve){
      var payload={prompt:prompt,size:size||'2K'};
      if(ratio)payload.ratio=ratio;
      if(uris&&uris.length)payload.images=uris;
      _apiResolve[id]=resolve;
      native('callApiAsync',JSON.stringify(payload),id);
    });
  }

  // ---------- 执行 ----------
  function dataUrl(b64){return 'data:image/png;base64,'+b64;}

  function mapPrefixValues(op, v, prefix){
    var out={};
    var def=SCHEMA.ops[op];
    (def.groups||[]).forEach(function(g){ g.fields.forEach(function(f){
      var full=prefix+'_'+f.key;
      if(v[full]!==undefined) out[f.key]=v[full];
    });});
    out.extra=v.extra; out.size=v.size; out.dry_run=v.dry_run;
    return out;
  }

  function runGenerate(op, v, image, id){
    var built=window.Prompts.build(op,v), prompt=built.prompt;
    var ratio=null;
    if(op==='idphoto'&&built.spec) ratio=window.Prompts.closestRatio(built.spec.px[0],built.spec.px[1]);
    else if(op==='outpaint'||op==='generate') ratio=v.ratio;
    else if(image&&image.width) ratio=window.Prompts.closestRatio(image.width,image.height);
    var uris=image?[image.uri]:(v.reference?[v.reference.uri]:null);
    return apiCallAsync(id,prompt,v.size,ratio,uris).then(function(r){
      return {r:r,built:built,prompt:prompt,ratio:ratio};
    });
  }

  function postProcess(op, ctx, v, image){
    if(!ctx.r.ok) return Promise.resolve({error:ctx.r.error});
    var src=dataUrl(ctx.r.data);
    var chain;
    if(op==='idphoto'&&ctx.built.spec){
      var spec=ctx.built.spec;
      chain=window.ImgTools.fitToCanvas(src,spec.px[0],spec.px[1]).then(function(single){
        var items=[{url:single,name:'证件照_'+spec.label+'.png',label:'证件照 '+spec.px.join('×')}];
        var layout=window.Prompts.layoutInfo(v);
        if(layout){
          return window.ImgTools.makeSheet(single,spec.px[0],spec.px[1],layout).then(function(sheet){
            items.push({url:sheet,name:layout.label+'_排版.png',label:layout.label+'排版'});
            return items;
          });
        }
        return items;
      });
    } else if(['background','retouch','style','restore','inpaint'].indexOf(op)>=0&&image&&image.width){
      chain=window.ImgTools.fitToCanvas(src,image.width,image.height).then(function(o){
        return [{url:o,name:op+'_'+Date.now()+'.png',label:'结果图'}];
      });
    } else {
      chain=Promise.resolve([{url:src,name:op+'_'+Date.now()+'.png',label:SCHEMA.labels[op]}]);
    }
    return chain.then(function(items){return {items:items,prompt:ctx.prompt};});
  }

  function run(op){
    var v=collectRaw(op);
    if(op==='batch')return runBatch();
    var image=(op==='generate'||op==='product')?(state[op].reference||state[op].image):state[op].image;
    if(!image&&['generate'].indexOf(op)<0){resultBox(op).innerHTML='<div class="msg err">请先选择图片。</div>';return;}
    if(op==='generate'&&!(v.prompt||'').trim()){resultBox(op).innerHTML='<div class="msg err">请填写画面描述。</div>';return;}
    resultBox(op).innerHTML='';
    if(v.dry_run){
      resultBox(op).innerHTML='<div class="card"><h2>📝 本次提示词</h2><div style="white-space:pre-wrap">'+esc(window.Prompts.build(op,v).prompt)+'</div></div>';
      return;
    }
    runGenerate(op,v,image,op).then(function(ctx){
      return postProcess(op,ctx,v,image);
    }).then(function(res){
      if(res.error){resultBox(op).innerHTML='<div class="msg err">❌ '+esc(res.error)+'</div>';return;}
      showResult(op,res.items,res.prompt);
      saveHistory(op,res.items);
    }).catch(function(e){resultBox(op).innerHTML='<div class="msg err">❌ '+esc(e.message)+'</div>';});
  }

  function runBatch(){
    var v=collectRaw('batch');
    if(!state.batch||!state.batch.folderUri){resultBox('batch').innerHTML='<div class="msg err">请先选择文件夹。</div>';return;}
    var listed=native('listImages',state.batch.folderUri);
    if(!listed.ok){resultBox('batch').innerHTML='<div class="msg err">'+esc(listed.error)+'</div>';return;}
    var op=v.batch_op||'idphoto';
    var files=listed.files.slice(0,parseInt(v.limit)>0?parseInt(v.limit):listed.files.length);
    if(v.dry_run){resultBox('batch').innerHTML='<div class="msg info">找到 '+files.length+' 张图片。操作：'+esc((SCHEMA.ops.batch.groups[0].fields[0].options.filter(function(o){return o.value===op;})[0]||{}).label)+'。取消预览后开始处理。</div>';return;}
    var bv=mapPrefixValues(op,v,{idphoto:'id',background:'bg',retouch:'rt',style:'st',restore:'rs'}[op]||'id');
    bv.size=v.size; bv.extra=v.extra; bv.dry_run=false;
    var done=0,ok=0;
    resultBox('batch').innerHTML='<div class="msg info">批量处理中…</div>';
    function next(i){
      if(i>=files.length){showResult('batch',[],null,'批量完成：成功 '+ok+' / '+files.length);return;}
      var file=files[i], read=native('readImage',file.uri);
      if(!read.ok){done++;return next(i+1);}
      var image={uri:file.uri,dataUri:read.dataUri,width:read.width,height:read.height};
      runGenerate(op,bv,image,'batch').then(function(ctx){return postProcess(op,ctx,bv,image);}).then(function(res){
        if(!res.error&&res.items&&res.items[0]){
          var name=read.name.replace(/\.[^.]+$/,'')+'_'+op+'.png';
          if(native('saveImage',res.items[0].url,name).ok)ok++;
        }
      }).catch(function(){}).then(function(){
        done++;
        var pr=document.getElementById('progress_batch'); if(pr)pr.style.display='none';
        resultBox('batch').innerHTML='<div class="msg info">批量处理中：'+done+' / '+files.length+' …</div>';
        next(i+1);
      });
    }
    next(0);
  }

  function resultBox(op){return document.getElementById('result_'+op);}
  function showResult(op,items,prompt,extraMsg){
    var html=extraMsg?'<div class="msg ok">'+esc(extraMsg)+'</div>':'<div class="msg ok">✅ 处理完成</div>';
    if(prompt)html+='<details><summary>查看本次提示词</summary><pre>'+esc(prompt)+'</pre></details>';
    if(items&&items.length){
      html+='<div class="imgs">';
      items.forEach(function(it,i){
        html+='<div class="item"><img src="'+it.url+'" alt="结果" onclick="openLightbox('+i+')">'+
          '<div class="cap">'+esc(it.label)+'</div>'+
          '<button class="btn ghost small" onclick="saveResult('+i+')">保存到相册</button></div>';
      });
      html+='</div>';
    }
    resultBox(op).innerHTML=html;
    window._lastResults=items||[];
  }
  window.saveResult=function(i){
    var it=(window._lastResults||[])[i]; if(!it)return;
    var r=native('saveImage',it.url,it.name); alert(r.ok?('已保存：'+r.path):('失败：'+r.error));
  };

  // 大图预览
  window.openLightbox=function(i){
    var it=(window._lastResults||[])[i]; if(!it)return;
    window._lbUrl=it.url;
    document.getElementById('lightboxImg').src=it.url;
    document.getElementById('lightbox').style.display='flex';
  };
  window.openLightboxUrl=function(url){ window._lbUrl=url;
    document.getElementById('lightboxImg').src=url;
    document.getElementById('lightbox').style.display='flex';};
  window.closeLightbox=function(){document.getElementById('lightbox').style.display='none';};
  document.getElementById('lbSave').onclick=function(){
    var r=native('saveImage',window._lbUrl,'AI相馆_'+Date.now()+'.png');
    alert(r.ok?('已保存：'+r.path):('失败：'+r.error));
  };

  // ---------- 批量动态参数 ----------
  function renderBatchDynamic(){
    var sel=document.querySelector('#form-batch select[data-key="batch_op"]');
    if(!sel)return;
    var op=sel.value;
    var host=document.getElementById('batchDynamic'); if(!host)return;
    host.innerHTML='';
    var groups=(SCHEMA.ops.batch.batchGroups||{})[op]||[];
    host.appendChild(buildGroups('batch',groups));
    state.batch=state.batch||{};
  }

  // ---------- 历史 ----------
  function saveHistory(op,items){
    if(!items||!items.length)return;
    window.ImgTools.makeThumb(items[0].url,150,200).then(function(thumb){
      var entry={op:op,label:SCHEMA.labels[op],prompt:(window.Prompts.build(op,collectRawSafe(op))||{}).prompt||'',
        thumb:thumb,time:new Date().toLocaleString('zh-CN')};
      native('saveHistory',JSON.stringify(entry));
    }).catch(function(){});
  }
  function collectRawSafe(op){ try{return collectRaw(op);}catch(e){return {};} }
  function openHistory(){
    document.getElementById('historySheet').style.display='block';
    loadHistory();
  }
  window.openHistory=openHistory;
  function closeHistory(){document.getElementById('historySheet').style.display='none';}
  window.closeHistory=closeHistory;
  function loadHistory(){
    var r=native('getHistory'), items=r.items||[];
    var grid=document.getElementById('historyGrid'); grid.innerHTML='';
    document.getElementById('historyCount').textContent=items.length?('共 '+items.length+' 条'):'';
    document.getElementById('historyEmpty').style.display=items.length?'none':'block';
    items.forEach(function(it){
      var d=el('div',{class:'history-item'});
      d.appendChild(el('img',{src:it.thumb,alt:'历史'}));
      d.appendChild(el('div',{class:'cap',text:(it.label||'')+' '+(it.time||'')}));
      d.onclick=function(){window.openLightboxUrl(it.thumb);};
      grid.appendChild(d);
    });
  }
  window.clearHistory=function(){
    if(!confirm('确定清空所有历史记录？'))return;
    native('clearHistory'); loadHistory();
  };

  // ---------- 设置 ----------
  function openSettings(){
    document.getElementById('settingsSheet').style.display='block';
    var cfg=native('getConfig');
    var fields=[['api_key','API Key（已配置时留空表示不变）','password'],
      ['base_url','Base URL','text'],['model','模型名','text'],['timeout','超时（秒）','number'],
      ['max_upload_mb','上传上限 MB','number'],['max_long_edge','长边上限 px','number'],
      ['size','默认档位 1K/2K/3K/4K','text']];
    var form=document.getElementById('settingsForm'); form.innerHTML='';
    fields.forEach(function(f){
      var wrap=el('div',{class:'field'});
      wrap.appendChild(el('label',{text:f[1]}));
      var input=el('input',{type:f[2],id:'cfg_'+f[0],value:cfg[f[0]]||''});
      if(f[0]==='api_key'&&cfg.api_key)input.placeholder='当前：'+cfg.api_key;
      wrap.appendChild(input); form.appendChild(wrap);
    });
    var theme=getStoredTheme();
    qa('#themeSeg button',function(b){b.classList.toggle('active',b.dataset.theme===theme);});
  }
  window.openSettings=openSettings;
  function closeSettings(){document.getElementById('settingsSheet').style.display='none';}
  window.closeSettings=closeSettings;
  function saveSettings(){
    var data={};
    ['api_key','base_url','model','timeout','max_upload_mb','max_long_edge','size'].forEach(function(k){
      data[k]=(document.getElementById('cfg_'+k).value||'').trim();});
    var r=native('saveConfig',JSON.stringify(data));
    document.getElementById('settingsMsg').innerHTML='<div class="msg '+(r.ok?'ok':'err')+'">'+(r.ok?'✅ 已保存':'❌ '+esc(r.error))+'</div>';
  }
  window.saveSettings=saveSettings;
  function testConnection(){
    document.getElementById('settingsMsg').innerHTML='<div class="msg info">测试中…</div>';
    var r=native('testConnection');
    document.getElementById('settingsMsg').innerHTML='<div class="msg '+(r.ok?'ok':'err')+'">'+(r.ok?'✅ ':'❌ ')+esc(r.message||r.error||'')+'</div>';
  }
  window.testConnection=testConnection;
  qa('#themeSeg button',function(b){
    b.onclick=function(){
      var m=b.dataset.theme; try{localStorage.setItem(THEME_KEY,m);}catch(e){}
      applyTheme(m); qa('#themeSeg button',function(x){x.classList.remove('active');});
      b.classList.add('active'); native('setTheme',m);
    };
  });

  // ---------- 导航 ----------
  function switchGroup(key){
    if(key==='history'){openHistory();return;}
    if(key==='settings'){openSettings();return;}
    qa('.nav-item',function(n){n.classList.toggle('active',n.dataset.group===key);});
    qa('.panel',function(p){p.classList.remove('active');});
    var subIds=(NAV_GROUPS.filter(function(g){return g.key===key;})[0]||{}).ops||[];
    if(key==='edit'){document.getElementById('panel-edit').classList.add('active');switchSub(currentEdit);}
    else if(key==='create'){document.getElementById('panel-create').classList.add('active');switchSub(currentCreate);}
    else if(subIds.length){document.getElementById('panel-'+subIds[0]).classList.add('active');currentOp=subIds[0];}
    window.scrollTo(0,0);
  }
  var currentEdit='background', currentCreate='generate';
  function switchSub(op){
    currentOp=op;
    qa('.panel .subtab',function(t){t.classList.toggle('active',t.dataset.op===op);});
    qa('.panel .subview',function(v){v.classList.toggle('active',v.id==='form-'+op);});
  }

  // ---------- 初始化 ----------
  function init(){
    applyTheme(getStoredTheme());
    var main=document.getElementById('main'), nav=document.getElementById('bottomNav');
    // 主面板
    var pMain=el('div',{class:'panel active',id:'panel-main'});
    pMain.appendChild(buildPanel('idphoto')); main.appendChild(pMain);
    // 修图面板（子标签）
    var pEdit=el('div',{class:'panel',id:'panel-edit'});
    var editTabs=el('div',{class:'subtabs'});
    NAV_GROUPS[1].ops.forEach(function(op,i){
      var t=el('div',{class:'subtab'+(i===0?' active':''),'data-op':op,text:SCHEMA.icons[op]+' '+SCHEMA.labels[op]});
      t.onclick=function(){switchSub(op);}; editTabs.appendChild(t);
    });
    pEdit.appendChild(editTabs);
    NAV_GROUPS[1].ops.forEach(function(op,i){
      var sv=el('div',{class:'subview'+(i===0?' active':''),id:'form-'+op});
      sv.appendChild(buildPanel(op)); pEdit.appendChild(sv);
    });
    main.appendChild(pEdit);
    // 创作面板（子标签）
    var pCreate=el('div',{class:'panel',id:'panel-create'});
    var ct=el('div',{class:'subtabs'});
    NAV_GROUPS[2].ops.forEach(function(op,i){
      var t=el('div',{class:'subtab'+(i===0?' active':''),'data-op':op,text:SCHEMA.icons[op]+' '+SCHEMA.labels[op]});
      t.onclick=function(){switchSub(op);}; ct.appendChild(t);
    });
    pCreate.appendChild(ct);
    NAV_GROUPS[2].ops.forEach(function(op,i){
      var sv=el('div',{class:'subview'+(i===0?' active':''),id:'form-'+op});
      sv.appendChild(buildPanel(op)); pCreate.appendChild(sv);
    });
    main.appendChild(pCreate);
    // 批量面板：动态参数区放在 form-batch 内部，便于统一收集
    var pBatch=el('div',{class:'panel',id:'panel-batch'});
    var batchPanel=buildPanel('batch');
    var dyn=el('div',{id:'batchDynamic'});
    batchPanel.insertBefore(dyn, batchPanel.lastChild); // 插在 action 卡片之前
    pBatch.appendChild(batchPanel);
    main.appendChild(pBatch);

    // 底部导航
    NAV_GROUPS.forEach(function(g,i){
      var b=el('button',{class:'nav-item'+(i===0?' active':''),'data-group':g.key});
      b.appendChild(el('span',{class:'ic',text:g.ic})); b.appendChild(el('span',{text:g.label}));
      b.onclick=function(){switchGroup(g.key);}; nav.appendChild(b);
    });

    // 批量动态参数：监听操作切换
    var batchSel=document.querySelector('#form-batch select[data-key="batch_op"]');
    if(batchSel){ batchSel.onchange=function(){renderBatchDynamic();}; }
    renderBatchDynamic();

    var bm=document.getElementById('bootMsg'); if(bm&&bm.parentNode)bm.parentNode.removeChild(bm);
    if(window.__bootCheck){clearTimeout(window.__bootCheck);window.__bootCheck=null;}
  }
  try{init();}catch(e){
    var mn=document.getElementById('main');
    if(mn)mn.innerHTML='<div class="card" style="border-color:#B3261E"><h2 style="color:#B3261E">⚠️ 初始化错误</h2><pre style="white-space:pre-wrap">'+e.message+'\n'+(e.stack||'')+'</pre></div>';
  }
})();
