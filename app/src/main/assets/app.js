/* AI 照相馆 Android 主逻辑 v2 */
(function () {
  'use strict';
  var SCHEMA = window.APP_SCHEMA || {ops:{},labels:{},icons:{}};
  var OPS = Object.keys(SCHEMA.ops);
  var state = {}, currentOp = OPS[0] || 'idphoto';
  var THEME_KEY = 'theme_mode';

  function native(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      var raw = window.Android[method].apply(window.Android, args);
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return {ok:false, error:method+': '+e.message};
    }
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
      try{ window.Android && window.Android.getSystemTheme && (dark = window.Android.getSystemTheme()==='dark'); }catch(e){}
      if(!window.Android) dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.documentElement.setAttribute('data-theme', dark?'dark':'light');
    var mt=document.querySelector('meta[name=theme-color]');
    if(mt) mt.setAttribute('content', dark?'#1E1E27':'#6750A4');
  }
  function getStoredTheme(){
    try{ return localStorage.getItem(THEME_KEY)||'system'; }catch(e){ return 'system'; }
  }

  // ---------- 字段渲染 ----------
  function fieldNode(op, f){
    var wrap=el('div',{class:'field'+(
      ['textarea','file','dir','stylegrid','example','color'].indexOf(f.type)>=0?' wide':'')});
    var label=el('label',{text:f.label});

    if(f.type==='boolopt'||f.type==='bool_true'){
      var box=el('input',{type:'checkbox'}); box.checked=!!f.default;
      box.dataset.key=f.key; box.dataset.type=f.type;
      return el('label',{class:'check'},[box,document.createTextNode(f.label)]);
    }
    if(f.type==='stylegrid'){
      wrap.appendChild(label);
      var grid=el('div',{class:'style-grid'});
      var opts=f.options||[];
      opts.forEach(function(item){
        var o=(typeof item==='object')?item:{label:item,desc:'',emoji:''};
        var card=el('div',{class:'style-card'+(o.label===f.default?' active':'')});
        card.dataset.value=o.label;
        card.appendChild(el('span',{class:'em',text:o.emoji||'✨'}));
        card.appendChild(el('span',{class:'nm',text:o.label}));
        if(o.desc) card.appendChild(el('span',{class:'ds',text:o.desc}));
        card.onclick=function(){
          grid.querySelectorAll('.style-card').forEach(function(c){c.classList.remove('active');});
          card.classList.add('active');
          state[op][f.key]=o.label;
        };
        grid.appendChild(card);
      });
      state[op][f.key]=f.default;
      wrap.appendChild(grid);
      return wrap;
    }
    if(f.type==='color'){
      wrap.appendChild(label);
      var row=el('div',{class:'color-row'});
      var picker=el('input',{type:'color',value:/^#[0-9a-fA-F]{6}$/.test(f.default)?f.default:'#438EDB'});
      picker.dataset.key=f.key; picker.dataset.type='color';
      var text=el('input',{type:'text',value:f.default||'#438EDB',placeholder:'#RRGGBB'});
      text.dataset.key=f.key+'_hex'; text.dataset.type='text';
      picker.oninput=function(){ text.value=picker.value; state[op][f.key]=picker.value; };
      text.oninput=function(){
        if(/^#[0-9a-fA-F]{6}$/.test(text.value)){ picker.value=text.value; state[op][f.key]=text.value; }
      };
      state[op][f.key]=f.default||'#438EDB';
      row.appendChild(picker); row.appendChild(text); wrap.appendChild(row);
      var sw=el('div',{class:'swatches'});
      ['#FFFFFF','#438EDB','#1F4E79','#D9001B','#EDEDED','#F5F1E8',
       '#4CAF50','#FF9800','#9C27B0','#00BCD4','#3F51B5','#000000'].forEach(function(c){
        var b=el('div',{class:'swatch'}); b.style.background=c;
        b.title=c; b.onclick=function(){ picker.value=c; text.value=c; state[op][f.key]=c; };
        sw.appendChild(b);
      });
      wrap.appendChild(sw);
      return wrap;
    }
    wrap.appendChild(label);
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
      input.oninput=function(){ rv.textContent=input.value; };
      var rangeRow=el('div',{class:'range-row'},[input,rv]);
      wrap.appendChild(rangeRow);
      input.dataset.key=f.key; input.dataset.type='range';
      if(f.help) wrap.appendChild(el('div',{class:'hint',text:f.help}));
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
    wrap.appendChild(input);

    if(f.type==='file'){
      var pv=el('img',{class:'picked',alt:'预览'}); pv.id='preview_'+op+'_'+f.key; wrap.appendChild(pv);
    }
    if(f.type==='dir'){
      wrap.appendChild(el('div',{class:'hint',id:'folder_'+op+'_'+f.key,text:'未选择文件夹'}));
    }
    if(f.type==='example' && f.example){
      var eb=el('button',{class:'example-btn',text:'填入示例'});
      eb.onclick=function(){ input.value=f.example; };
      var box=el('div',{class:'example-box'},[input,eb]);
      wrap.replaceChild(box, input);
      input.dataset.key=f.key; input.dataset.type=f.type;
    }
    if(f.help && ['textarea','example','file','dir'].indexOf(f.type)<0){
      wrap.appendChild(el('div',{class:'hint',text:f.help}));
    }
    return wrap;
  }

  function buildForm(op){
    var def=SCHEMA.ops[op]; var box=el('div',{class:'card'});
    box.appendChild(el('h2',{text:def.icon+'  '+def.label}));
    var grid=el('div',{class:'grid'});
    def.fields.forEach(function(f){ grid.appendChild(fieldNode(op,f)); });
    box.appendChild(grid);
    if(op==='generate'){
      var optBtn=el('button',{class:'btn ghost small',text:'🪄 AI 一键优化提示词',onclick:function(){
        var prompt=(state[op].prompt)||'';
        var area=document.querySelector('#form-generate textarea[data-key="prompt"]');
        if(area) prompt=area.value;
        if(!prompt.trim()){alert('请先填写画面描述');return;}
        var r=native('enhancePrompt',prompt);
        if(r.ok){ if(area) area.value=r.result; state[op].prompt=r.result; alert('已优化提示词'); }
        else alert('优化失败：'+r.error);
      }});
      box.insertBefore(optBtn, grid);
    }
    if(op==='retouch'){
      var pv=el('div',{class:'preview-box',id:'retouch_preview_'+op});
      pv.appendChild(el('img',{id:'retouch_preview_img_'+op,alt:'效果预览'}));
      box.appendChild(pv);
      var pb=el('button',{class:'btn ghost small',text:'👁 预览当前参数效果（本地示意）',onclick:function(){
        previewRetouch(op);
      }});
      box.appendChild(pb);
    }
    var btn=el('button',{class:'btn',type:'button',text:'✨ 开始处理'});
    btn.onclick=function(){ run(op); };
    box.appendChild(btn);
    box.appendChild(el('div',{class:'hint',style:'margin-top:8px;text-align:center',
      text:'提示：勾选「只预览提示词」可免费查看 AI 会怎么处理'}));
    box.appendChild(el('div',{id:'result_'+op}));
    return box;
  }

  function collect(op){
    var values={};
    document.querySelectorAll('#form-'+op+' [data-key]').forEach(function(node){
      var k=node.dataset.key,t=node.dataset.type;
      if(t==='bool_true'||t==='boolopt') values[k]=node.checked;
      else if(t==='range') values[k]=parseInt(node.value);
      else if(t==='color'){ if(state[op]&&state[op][k]) values[k]=state[op][k]; }
      else if(t==='file'){ if(state[op]&&state[op][k]) values[k]=state[op][k]; }
      else values[k]=node.value;
    });
    // stylegrid 值来自 state
    SCHEMA.ops[op].fields.forEach(function(f){
      if(f.type==='stylegrid' && state[op][f.key]) values[f.key]=state[op][f.key];
    });
    return values;
  }

  // ---------- 原生回调 ----------
  window.onImagePicked=function(json){
    var r=typeof json==='string'?JSON.parse(json):json;
    if(!r.ok){ alert('选择图片失败：'+r.error); return; }
    var key;
    if(currentOp==='generate') key='reference';
    else { var f=SCHEMA.ops[currentOp].fields.filter(function(x){return x.type==='file';})[0]; key=f?f.key:'image'; }
    state[currentOp]=state[currentOp]||{}; state[currentOp][key]=r;
    var pv=document.getElementById('preview_'+currentOp+'_'+key);
    if(pv){pv.src=r.dataUri;pv.style.display='block';}
    var info=el('div',{class:'hint',text:'📐 '+r.width+'×'+r.height+' · '+r.name});
    if(pv && pv.parentNode) pv.parentNode.appendChild(info);
  };
  window.onFolderPicked=function(json){
    var r=typeof json==='string'?JSON.parse(json):json;
    if(!r.ok){ alert('选择文件夹失败：'+r.error); return; }
    state[currentOp]=state[currentOp]||{}; state[currentOp].folderUri=r.uri;
    var lab=document.getElementById('folder_'+currentOp+'_input_dir');
    if(lab) lab.textContent=r.uri;
  };

  // ---------- 结果 ----------
  function resultBox(op){return document.getElementById('result_'+op);}
  function showImages(op,items,extraHtml){
    var html='<div class="msg ok">✅ 处理完成</div>';
    if(extraHtml)html+=extraHtml;
    if(items&&items.length){
      html+='<div class="card"><h2>🖼️ 生成结果（点按钮保存到相册）</h2><div class="imgs">';
      items.forEach(function(it,i){
        html+='<div class="item"><img src="'+it.url+'" alt="结果"><div class="cap">'+esc(it.label)+'</div>'+
          '<button class="btn ghost small" style="width:calc(100% - 12px);margin:0 6px 6px" onclick="saveResult('+i+')">保存到相册</button></div>';
      });
      html+='</div></div>';
    }
    html+='<details><summary>调试信息</summary><pre>'+esc(JSON.stringify({count:(items||[]).length},null,2))+'</pre></details>';
    resultBox(op).innerHTML=html;
    window._lastResults=items||[];
  }
  window.saveResult=function(i){
    var item=(window._lastResults||[])[i]; if(!item)return;
    var r=native('saveImage',item.url,item.name);
    alert(r.ok?('已保存：'+r.path):('保存失败：'+r.error));
  };

  function apiCall(prompt,size,ratio,images){
    var payload={prompt:prompt,size:size||'2K'};
    if(ratio)payload.ratio=ratio;
    if(images&&images.length)payload.images=images;
    return native('callApi',JSON.stringify(payload));
  }
  function dataUrl(b64){return 'data:image/png;base64,'+b64;}

  function generateOnce(op,v,image){
    var built=window.Prompts.build(op,v), prompt=built.prompt;
    if(v.dry_run) return Promise.resolve({dry:true,prompt:prompt});
    var ratio;
    if(op==='idphoto'&&built.spec) ratio=window.Prompts.closestRatio(built.spec.px[0],built.spec.px[1]);
    else if(op==='outpaint'||op==='generate') ratio=v.ratio;
    else if(image) ratio=window.Prompts.closestRatio(image.width,image.height);
    var images=image?[image.dataUri]:(v.reference?[v.reference.dataUri]:null);
    return new Promise(function(resolve){
      var r=apiCall(prompt,v.size,ratio,images);
      if(!r.ok)return resolve({error:r.error});
      var src=dataUrl(r.data), chain;
      if(op==='idphoto'&&built.spec){
        chain=window.ImgTools.fitToCanvas(src,built.spec.px[0],built.spec.px[1]).then(function(single){
          var items=[{url:single,name:'证件照_'+built.spec.label+'.png',label:'证件照 '+built.spec.px.join('×')}];
          var layout=window.Prompts.layoutInfo(v);
          if(layout){
            var cnt=layout.count||0;
            return window.ImgTools.makeSheet(single,built.spec.px[0],built.spec.px[1],layout)
              .then(function(sheet){
                items.push({url:sheet,name:layout.label+'_排版.png',label:layout.label+'排版'});
                return {items:items,prompt:prompt};
              });
          }
          return {items:items,prompt:prompt};
        });
      } else if(['background','retouch','style','restore'].indexOf(op)>=0&&image){
        chain=window.ImgTools.fitToCanvas(src,image.width,image.height).then(function(out){
          return {items:[{url:out,name:op+'_'+Date.now()+'.png',label:'结果图'}],prompt:prompt};
        });
      } else {
        chain=Promise.resolve({items:[{url:src,name:op+'_'+Date.now()+'.png',label:op==='generate'?'文生图':'扩图'}],prompt:prompt});
      }
      chain.then(resolve).catch(function(e){resolve({error:e.message});});
    });
  }

  function previewRetouch(op){
    var v=collect(op); var img=state[op].image;
    if(!img){alert('请先选择图片');return;}
    var box=document.getElementById('retouch_preview_'+op);
    box.style.display='block';
    window.ImgTools.previewRetouch(img.dataUri,v).then(function(out){
      document.getElementById('retouch_preview_img_'+op).src=out;
    }).catch(function(e){alert('预览失败:'+e.message);});
  }

  function run(op){
    var box=resultBox(op), v=collect(op);
    if(op!=='generate'&&op!=='batch'&&!state[op].image){box.innerHTML='<div class="msg err">请先选择图片。</div>';return;}
    if(op==='batch')return runBatch(op,v);
    if(op==='generate'&&!v.prompt){box.innerHTML='<div class="msg err">请填写画面描述。</div>';return;}
    box.innerHTML='<div class="msg">处理中… 图像生成通常需要几十秒，请保持页面打开。</div>';
    generateOnce(op,v,state[op].image).then(function(res){
      if(res.dry){ box.innerHTML='<div class="card"><h2>📝 本次提示词</h2><div style="white-space:pre-wrap">'+esc(res.prompt)+'</div></div>'; return; }
      if(res.error){box.innerHTML='<div class="msg err">❌ '+esc(res.error)+'</div>';return;}
      showImages(op,res.items);
    });
  }

  function batchValues(v){
    var map={idphoto:'id_',background:'bg_',retouch:'rt_',style:'st_',restore:'rs_'};
    var prefix=map[v.batch_op]||'id_';
    var out={extra:v.extra||'',size:v.size||'2K',dry_run:false};
    SCHEMA.ops.batch.fields.forEach(function(f){
      if(f.key.indexOf(prefix)===0) out[f.key.substring(prefix.length)]=v[f.key];
    });
    if(v.batch_op==='idphoto'){ out.layout=out.layout||'不排版（仅单张）'; }
    return out;
  }

  function runBatch(op,v){
    var box=resultBox(op), folder=state[op].folderUri;
    if(!folder){box.innerHTML='<div class="msg err">请先选择文件夹。</div>';return;}
    var listed=native('listImages',folder);
    if(!listed.ok){box.innerHTML='<div class="msg err">'+esc(listed.error)+'</div>';return;}
    if(v.dry_run){
      box.innerHTML='<div class="msg ok">找到 '+listed.files.length+' 张图片。操作：'+esc(
        (SCHEMA.ops.batch.fields[0].options.filter(function(o){return o.value===v.batch_op;})[0]||{}).label||v.batch_op
      )+'。取消「只预览提示词」并点开始处理即可执行。</div>';
      return;
    }
    var files=listed.files.slice(0,parseInt(v.limit)>0?parseInt(v.limit):listed.files.length);
    var bv=batchValues(v); var done=0,ok=0;
    box.innerHTML='<div class="msg">批量处理中：0 / '+files.length+' …</div>';
    function next(i){
      if(i>=files.length){ showImages(op,[],'<div class="msg ok">批量完成：成功 '+ok+' / '+files.length+'</div>'); return; }
      var file=files[i];
      var read=native('readImage',file.uri);
      if(!read.ok){box.innerHTML='<div class="msg err">读取失败：'+esc(file.name)+' - '+esc(read.error)+'</div>';return next(i+1);}
      var image={dataUri:read.dataUri,width:read.width,height:read.height,name:read.name};
      bv.dry_run=false;
      generateOnce(v.batch_op,bv,image).then(function(res){
        if(!res.error&&res.items&&res.items[0]){
          var name=read.name.replace(/\.[^.]+$/,'')+'_'+v.batch_op+'.png';
          var saved=native('saveImage',res.items[0].url,name);
          if(saved.ok)ok++;
        }
        done++;
        box.innerHTML='<div class="msg">批量处理中：'+done+' / '+files.length+' …</div>';
        next(i+1);
      });
    }
    next(0);
  }

  // ---------- 底部导航 ----------
  var NAV=[
    {op:'idphoto',ic:'🪪',label:'证件照'},
    {op:'background',ic:'🌄',label:'换背景'},
    {op:'retouch',ic:'✨',label:'精修'},
    {op:'generate',ic:'🖼️',label:'文生图'},
    {op:'batch',ic:'📚',label:'批量'}
  ];
  // 其余功能放进"更多"：通过 appbar 副标题点击切换 / 这里增加第6项
  function switchTab(op){
    currentOp=op;
    document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('active',p.id==='form-'+op);});
    document.querySelectorAll('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.op===op);});
    window.scrollTo(0,0);
  }

  // ---------- 设置 ----------
  function openSettings(){
    document.getElementById('settingsSheet').style.display='block';
    var cfg=native('getConfig');
    var fields=[
      ['api_key','API Key（已配置时留空表示不变）','password'],
      ['base_url','Base URL','text'],['model','模型名','text'],
      ['timeout','超时（秒）','number'],['max_upload_mb','上传上限 MB','number'],
      ['max_long_edge','长边上限 px','number'],['size','默认档位 1K/2K/3K/4K','text']
    ];
    var form=document.getElementById('settingsForm'); form.innerHTML='';
    fields.forEach(function(f){
      var wrap=el('div',{class:'field'});
      wrap.appendChild(el('label',{text:f[1]}));
      var input=el('input',{type:f[2],id:'cfg_'+f[0],value:cfg[f[0]]||''});
      if(f[0]==='api_key'&&cfg.api_key) input.placeholder='当前：'+cfg.api_key;
      wrap.appendChild(input); form.appendChild(wrap);
    });
    var theme=getStoredTheme();
    document.querySelectorAll('#themeSeg button').forEach(function(b){
      b.classList.toggle('active',b.dataset.theme===theme);
    });
  }
  window.openSettings=openSettings;
  function closeSettings(){document.getElementById('settingsSheet').style.display='none';}
  window.closeSettings=closeSettings;
  function saveSettings(){
    var data={};
    ['api_key','base_url','model','timeout','max_upload_mb','max_long_edge','size'].forEach(function(k){
      data[k]=(document.getElementById('cfg_'+k).value||'').trim();
    });
    var r=native('saveConfig',JSON.stringify(data));
    document.getElementById('settingsMsg').innerHTML='<div class="msg '+(r.ok?'ok':'err')+'">'+
      (r.ok?'✅ 已保存':'❌ '+esc(r.error))+'</div>';
  }
  window.saveSettings=saveSettings;
  function testConnection(){
    document.getElementById('settingsMsg').innerHTML='<div class="msg">测试中…</div>';
    var r=native('testConnection');
    document.getElementById('settingsMsg').innerHTML='<div class="msg '+(r.ok?'ok':'err')+'">'+
      (r.ok?'✅ ':'❌ ')+esc(r.message||r.error||'')+'</div>';
  }
  window.testConnection=testConnection;
  document.querySelectorAll('#themeSeg button').forEach(function(b){
    b.onclick=function(){
      var m=b.dataset.theme;
      try{localStorage.setItem(THEME_KEY,m);}catch(e){}
      applyTheme(m);
      document.querySelectorAll('#themeSeg button').forEach(function(x){x.classList.remove('active');});
      b.classList.add('active');
      native('setTheme',m);
    };
  });

  // ---------- 初始化 ----------
  function init(){
    applyTheme(getStoredTheme());
    var main=document.getElementById('main'), nav=document.getElementById('bottomNav');
    OPS.forEach(function(op,i){
      state[op]={};
      var panel=el('section',{class:'panel'+(i===0?' active':''),id:'form-'+op});
      panel.appendChild(buildForm(op));
      main.appendChild(panel);
    });
    NAV.forEach(function(item,i){
      var b=el('button',{class:'nav-item'+(i===0?' active':''),'data-op':item.op});
      b.appendChild(el('span',{class:'ic',text:item.ic}));
      b.appendChild(el('span',{text:item.label}));
      b.onclick=function(){switchTab(item.op);};
      nav.appendChild(b);
    });
    // 把非导航功能（写真/修复/扩图）做成顶部副标题可点切换的下拉
    var extraOps=OPS.filter(function(o){return !NAV.some(function(n){return n.op===o;});});
    var sel=el('select',{style:'width:100%;margin-top:8px;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--card);color:var(--ink)'});
    sel.appendChild(el('option',{value:'',text:'— 更多功能：写真 / 修复 / 扩图 —'}));
    extraOps.forEach(function(o){
      sel.appendChild(el('option',{value:o,text:(SCHEMA.icons[o]||'')+' '+SCHEMA.labels[o]}));
    });
    sel.onchange=function(){ if(sel.value){switchTab(sel.value);sel.value='';} };
    document.querySelector('.appbar').appendChild(sel);
  }
  init();
})();
