/* 提示词构建：移植自 presets.py 并扩展发型/发色/排版/服装 */
(function (global) {
  'use strict';

  var RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'];

  var ID_SPECS = [
    { label: '小一寸', mm: '22×32毫米', px: [260, 378], dpi: 300, usage: '驾驶证、部分证件' },
    { label: '一寸', mm: '25×35毫米', px: [295, 413], dpi: 300, usage: '简历、学生证、各类报名表' },
    { label: '大一寸', mm: '33×48毫米', px: [390, 567], dpi: 300, usage: '考试报名、资格证' },
    { label: '小二寸', mm: '35×45毫米', px: [413, 531], dpi: 300, usage: '部分签证、入职材料' },
    { label: '二寸', mm: '35×49毫米', px: [413, 579], dpi: 300, usage: '毕业证、工作证' },
    { label: '护照 / 港澳通行证', mm: '33×48毫米', px: [390, 567], dpi: 300, usage: '护照、通行证' },
    { label: '身份证 / 社保回执', mm: '26×32毫米', px: [358, 441], dpi: 350, usage: '身份证数码回执' },
    { label: '申根签证', mm: '35×45毫米', px: [413, 531], dpi: 300, usage: '申根签证' },
    { label: '美国签证', mm: '51×51毫米', px: [602, 602], dpi: 300, usage: '美签（方形）' },
    { label: '日本签证', mm: '45×45毫米', px: [531, 531], dpi: 300, usage: '日签（方形）' }
  ];
  var ID_TYPES = {
    '身份证 / 社保回执': '身份证 / 社保回执', '中国护照 / 港澳通行证': '护照 / 港澳通行证',
    '驾驶证': '小一寸', '简历 / 学生证': '一寸', '考试报名 / 资格证': '大一寸',
    '入职 / 部分签证': '小二寸', '毕业证 / 工作证': '二寸', '申根签证': '申根签证',
    '美国签证': '美国签证', '日本签证': '日本签证', '自定义尺寸': '自定义尺寸'
  };
  var ID_BG = {
    '纯白': '纯白色（#FFFFFF）', '标准蓝': '标准证件照蓝色（#438EDB）',
    '深蓝': '深蓝色（#1F4E79）', '标准红': '标准证件照红色（#D9001B）',
    '浅灰': '浅灰色（#EDEDED）', '米白': '柔和米白色（#F5F1E8）',
    '渐变蓝': '标准蓝色渐变背景（中心稍亮、四周略深）',
    '渐变灰': '影楼灰色渐变背景（上深下浅、过渡柔和）'
  };
  var BG_SCENES = {
    '纯白背景': '#FFFFFF', '标准蓝背景': '#438EDB', '标准红背景': '#D9001B',
    '浅灰影棚': '#E8E8E8',
    '渐变影棚': '影楼常用背景：上深下浅的柔和灰色渐变，类似真实棚拍布景',
    '户外花园': '阳光下的花园绿植背景，自然虚化，明亮清新',
    '城市街景': '现代城市街景背景，浅景深虚化，白天自然光',
    '简约室内': '简约温馨的室内环境，白墙与原木家具，柔和自然光',
    '书架书房': '书房木书架与暖色台灯，安静知性的氛围',
    '海边度假': '海边沙滩与蓝色海面，明亮自然光，度假氛围',
    '咖啡馆': '安静的咖啡馆室内，木质桌椅与暖色灯光，浅景深虚化',
    '公园草地': '公园草地与树木，阳光透过树叶的柔和光斑，清新自然',
    '图书馆': '图书馆书架与阅览区，安静书卷气，柔和室内光',
    '纯色 · 米色': '#EFE6D8', '纯色 · 浅粉': '#F3DDE0', '纯色 · 淡绿': '#DDE8DC'
  };
  var STYLE_PRESETS = {
    '职业形象照': '专业商务职业形象写真：合体西装或衬衫，浅灰渐变影楼背景，柔和商业布光，气质干练自信',
    '商务头像': '简洁商务头像：纯色或浅灰背景，干净利落的职业装扮，正面或微侧脸，光线均匀',
    '韩系清新': '韩系清新棚拍写真：浅色针织或衬衫，奶油色简洁背景，柔和自然光，通透肤感',
    '汉服古风': '中国古风汉服写真：宋制或明制汉服，古典发髻与淡雅妆容，竹林庭院或古建筑背景，柔和自然光，国风人像摄影质感',
    '学士服毕业照': '毕业学士服写真：黑色学位袍与学位帽，流苏自然垂下，大学校园草坪背景，阳光明媚',
    '婚纱礼服': '影楼婚纱礼服写真：白色轻纱礼服，梦幻花瓣与暖色背景虚化，柔美聚光',
    '艺术 · 水墨画': '写意水墨画：宣纸质感，墨色浓淡晕染，留白构图，水墨人物韵味',
    '艺术 · 油画': '古典油画：厚涂笔触感，伦勃朗式光影，浓郁色调，油画布质感',
    '艺术 · 动漫': '精致动漫插画风：干净线稿，赛璐璐上色，明亮通透的色彩，日系动画质感',
    '艺术 · 赛博朋克': '赛博朋克风格：霓虹蓝紫色灯光，湿润街道反光，未来都市背景，电影质感',
    '艺术 · 复古胶片': '90年代复古胶片质感：轻微颗粒与褪色，暖色调，港风或日系街拍氛围',
    '艺术 · 黑白经典': '经典黑白人像：细腻灰阶过渡，影棚硬光造型，永久质感'
  };
  var GEN_STYLES = {
    '摄影写实': '写实摄影风格，真实光影与材质，像专业相机拍摄',
    '电影感': '电影剧照质感，宽银幕构图，戏剧化光影，浅景深',
    '自然光人像': '自然光人像摄影，柔和窗光，通透肤色，真实质感',
    '产品摄影': '专业产品摄影，干净背景，均匀柔光，细节锐利',
    '插画': '精致数字插画，干净线条，柔和配色，画面层次丰富',
    '3D 渲染': '3D 渲染风格，柔和材质，全局光照，细腻质感',
    '水墨国风': '中国水墨画风格，宣纸质感，墨色晕染，留白意境',
    '油画': '古典油画风格，厚涂笔触，浓郁色彩，画布质感',
    '极简海报': '极简海报设计，大面积留白，克制的配色，现代排版感'
  };
  var EXPRESSION = {
    '自然': '表情自然放松，嘴唇自然闭合', '微笑': '嘴角自然上扬，轻微微笑，不露齿',
    '露齿微笑': '自然露齿微笑，牙齿整洁', '严肃': '表情端庄严肃，嘴唇自然闭合'
  };
  var MAKEUP = {
    '素颜（不化妆）': '保持自然素颜状态，不化妆', '淡妆': '淡雅自然的证件照生活妆，干净清爽',
    '精致妆': '精致证件照妆容，底妆均匀，五官立体但不过度修饰'
  };
  var GLASSES = {
    '保持原样': '', '去除眼镜（避免反光）': '去除眼镜，避免镜片反光与阴影',
    '保留眼镜（去除反光）': '保留本人眼镜，但消除镜片反光与阴影，镜框不遮挡眼睛'
  };
  var SKIN = {
    '保留原肤质': '保留真实皮肤质感，不做磨皮',
    '自然修饰': '轻度修饰肤色与瑕疵，保留自然皮肤纹理',
    '轻度磨皮': '适度磨皮但保留毛孔与纹理，不要塑料感'
  };
  var HEADROOM = {
    '标准': '头顶保留适当空白（约画面高度的 5%–8%）',
    '略多': '头顶留白稍多，人物整体略小', '略少': '头顶留白较少，头部稍大但五官完整'
  };
  var HAIR_TEXT = {
    '保持原样': '', '整理碎发': '头发整齐，收拢碎发，不遮挡眉毛、眼睛和耳朵',
    '自然短发': '清爽自然的短发，干净利落', '中分商务发型': '中分商务发型，服帖有型，专业干练',
    '侧分油头': '侧分油头造型，发丝整齐有光泽', '蓬松卷发': '自然蓬松的卷发，富有层次感',
    '齐肩发': '齐肩中长发，柔顺自然', '高马尾': '利落的高马尾，露出额头与脖颈',
    '丸子头': '清爽的丸子头造型', '古风发髻': '古典发髻造型，配合传统妆容',
    '双麻花辫': '双麻花辫造型，青春减龄', '自然长发': '自然垂落的长发，柔顺有光泽',
    '清爽短发': '清爽短发造型，精神利落'
  };
  var HAIR_COLOR_TEXT = {
    '保持原发色': '', '自然黑': '自然黑色头发', '深棕色': '深棕色头发',
    '栗棕色': '栗棕色头发', '亚麻金色': '亚麻金色头发', '酒红色': '酒红色头发',
    '蓝黑色': '蓝黑色头发', '冷茶色': '冷茶色头发', '挑染': '带自然挑染效果的发色'
  };
  var ID_BG_HEX = {
    '纯白': '#FFFFFF', '标准蓝': '#438EDB', '深蓝': '#1F4E79', '标准红': '#D9001B',
    '浅灰': '#EDEDED', '米白': '#F5F1E8'
  };
  var PRODUCT_SCENES = {
    '纯白影棚': '纯净的白色无缝影棚背景，干净利落，突出商品主体',
    '高级灰渐变': '高级灰渐变背景，中心稍亮、四周略暗，质感克制高级',
    '原木桌面': '浅色原木桌面与柔和背景，自然温暖，适合生活类商品',
    '大理石台面': '白色大理石台面，细腻纹理，轻奢质感',
    '户外自然光': '户外自然光环境，绿植与柔和阳光虚化背景，清新自然',
    '节日氛围': '节日促销氛围，暖色灯光与简洁节日装饰虚化背景，热闹但不杂乱',
    '科技暗调': '深色科技感背景，冷色轮廓光，适合数码与电子产品',
    '生活场景': '真实生活使用场景，环境自然虚化，商品清晰突出'
  };
  var PRODUCT_PURPOSE = {
    '电商主图 1:1': { ratio: '1:1', w: 1600, h: 1600, label: '电商主图' },
    '详情页 3:4': { ratio: '3:4', w: 1600, h: 2133, label: '详情页' },
    '海报 9:16': { ratio: '9:16', w: 1440, h: 2560, label: '海报' },
    '社交分享 4:5': { ratio: '4:5', w: 1600, h: 2000, label: '社交分享' }
  };

  function closestRatio(w, h) {
    var r = parseFloat(w) / parseFloat(h), best = null;
    RATIOS.forEach(function (name) {
      var p = name.split(':'), v = parseFloat(p[0]) / parseFloat(p[1]);
      var delta = Math.abs(r - v) / v;
      if (!best || delta < best[0]) best = [delta, name];
    });
    return best ? best[1] : '1:1';
  }
  function resolveSpec(v) {
    var label = v.spec || '一寸';
    if (label === '自定义尺寸') {
      var w = Math.max(20, Math.min(6000, parseInt(v.width) || 295));
      var h = Math.max(20, Math.min(6000, parseInt(v.height) || 413));
      var d = Math.max(72, Math.min(1200, parseInt(v.dpi) || 300));
      return { label:'自定义', px:[w,h], dpi:d,
        mm:(w*25.4/d).toFixed(1)+'×'+(h*25.4/d).toFixed(1)+'毫米', usage:'证件照' };
    }
    for (var i=0;i<ID_SPECS.length;i++) if (ID_SPECS[i].label===label) return ID_SPECS[i];
    return ID_SPECS[1];
  }
  function specForType(type){ return ID_TYPES[type] || null; }
  function idBgDescription(label, hex){
    if (label==='自定义颜色') return '纯色背景（'+(hex||'#FFFFFF')+'）';
    return ID_BG[label] || ('纯色背景（'+(hex||'#FFFFFF')+'）');
  }
  function idBgHex(label, hex){
    if (label==='自定义颜色') return hex||'#FFFFFF';
    return ID_BG_HEX[label] || hex || '#FFFFFF';
  }
  function sceneDescription(label, hex, text){
    if (label==='自定义纯色') return '纯色背景（'+(hex||'#FFFFFF')+'）';
    if (label==='自定义描述') return (text||'').trim() || '简洁干净的纯色背景';
    if (BG_SCENES[label] && /^#/.test(BG_SCENES[label]))
      return label.replace('背景','')+'（'+BG_SCENES[label]+'）';
    return (BG_SCENES[label]||label).replace('背景','');
  }
  function join(parts){
    return parts.filter(function(x){return x && x.trim();}).map(function(x){
      return x.replace(/。+$/,'');
    }).join('。')+'。';
  }
  function outfitText(v){
    var o = v.outfit || '保持原服装';
    if (o === '保持原服装') return '保持原照片中的服装、颜色和款式不变';
    if (o === '自动选择得体服装') return '服装调整为适合证件照的整洁正装，替代原服装';
    if (o === '自定义服装描述…') return (v.outfit_custom||'').trim()
      ? ('服装必须改为：'+(v.outfit_custom||'').trim()+'，替换原服装，着装整洁合身') : '保持原服装';
    var desc = o.indexOf('｜')>=0 ? o.split('｜')[1] : o;
    return '服装必须改为：'+desc+'，替换原服装，剪裁合身、整洁得体，不要保留原服装或出现其他款式';
  }
  function hairText(v){
    var arr = [];
    var hb = HAIR_TEXT[v.hair] || ''; if (hb) arr.push(hb);
    var hc = HAIR_COLOR_TEXT[v.hair_color] || ''; if (hc) arr.push(hc);
    var custom = (v.hair_custom||'').trim();
    if (custom && (v.hair === '自定义发型…' || v.hair_color === '自定义发色…')) {
      arr.push(custom);
    }
    return arr.join('，');
  }
  function idPrompt(spec, v){
    var w=spec.px[0], h=spec.px[1];
    var parts=[
      '把这张照片制作成一张标准的'+spec.label+'证件照（'+spec.mm+'，约'+w+'×'+h+'像素，用于'+spec.usage+'）',
      '人物是照片中的同一个人：严格保持五官、脸型、肤色一致，真实自然，不做过度美颜，不改变长相',
      '正面免冠头像，头部居中，肩部以上构图，头部高度约占画面三分之二',
      '平视镜头，'+(EXPRESSION[v.expression]||EXPRESSION['自然'])
    ];
    var bg=idBgDescription(v.bg,v.color);
    parts.push(/渐变/.test(v.bg)||/渐变/.test(bg)
      ? '背景为'+bg+'，过渡柔和均匀，无杂物、无强烈阴影'
      : '背景为'+bg+'，均匀纯净，无阴影、无渐变杂色、无杂物');
    parts.push('画面比例接近 '+closestRatio(w,h)+'，'+(w===h?'方形构图':(w>h?'横版构图':'竖版构图')));
    if (v.ears) parts.push('双耳完整露出，眉毛和眼睛清晰可见');
    parts.push(HEADROOM[v.headroom]||HEADROOM['标准']);
    parts.push(SKIN[v.skin]||SKIN['自然修饰']);
    parts.push(MAKEUP[v.makeup]||MAKEUP['淡妆']);
    var g=GLASSES[v.glasses]||''; if(g) parts.push(g);
    var ht=hairText(v); if(ht) parts.push('发型：'+ht);
    var ot=outfitText(v); if(ot) parts.push(ot);
    if (v.beauty) parts.push('整体自然美化：肤色干净均匀，精神饱满，保留真实质感');
    if (v.enhance) parts.push('画质清晰锐利，光线均匀柔和，影楼级专业证件照质感');
    if ((v.extra||'').trim()) parts.push('补充要求：'+cleanText(v.extra));
    if (ot) parts.push('最终服装必须为：'+ot.replace(/^服装必须改为：/,''), '不要保留原服装');
    return join(parts);
  }
  function bgreplacePrompt(v){
    var bg=sceneDescription(v.scene,v.color,v.custom);
    var parts=['把这张照片的背景替换为：'+bg,
      '完整保留主体人物的外貌、表情、发型、姿势和服装不变',
      '新背景的光线方向与人物光照一致，整体像在同一场景真实拍摄的照片',
      '人物与背景自然融合，景深和透视合理'];
    var blur={'无虚化（背景清晰）':'背景保持清晰，景深自然','轻微虚化':'背景轻微虚化，主体清晰突出',
      '明显虚化（人像模式）':'背景明显虚化，浅景深人像效果，光斑柔和'}[v.blur]; if(blur)parts.push(blur);
    var light={'自动匹配原图':'光线方向自动匹配原图人物','左侧自然光':'主光来自画面左侧，光线柔和自然',
      '右侧自然光':'主光来自画面右侧，光线柔和自然','正面柔光':'正面柔和布光，面部受光均匀',
      '逆光轮廓光':'逆光轮廓光，人物边缘有自然高光，面部补光'}[v.light]; if(light)parts.push(light);
    if(v.shadow)parts.push('保留人物脚下或身体与背景接触处的自然阴影，避免人物像贴纸一样悬浮');
    if(v.edge)parts.push('精细处理发丝与衣物边缘，无白边、锯齿或抠图痕迹');
    if(v.tone)parts.push('统一人物与新背景的色温、曝光与对比度');
    if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
    return join(parts);
  }
  function retouchPrompt(v){
    var words={'轻微':'轻微修饰，几乎看不出修图痕迹','自然':'自然适度，像天生好皮肤','明显':'明显改善但仍保持真实感'};
    var parts=['对这张人像照片进行专业影楼级精修，修图程度：'+(words[v.strength]||words['自然']),
      '保持人物身份特征、五官比例、脸型和整体构图不变，效果自然不做作'];
    var items=[];
    var acne=parseInt(v.acne)||0; if(acne>0)items.push('修饰皮肤瑕疵（痘印、色斑、细纹），程度约'+acne+'%，保留自然皮肤纹理');
    var smooth=parseInt(v.smooth)||0; if(smooth>0)items.push('磨皮程度约'+smooth+'%，保留毛孔与皮肤细节');
    var br=parseInt(v.brighten)||0; if(br>0)items.push('均匀提亮肤色，程度约'+br+'%，肤色自然通透');
    items.push('优化面部光影，像摄影师重新布光一样立体干净');
    var eyes=parseInt(v.eyes)||0; if(eyes>0)items.push('提亮眼神光程度约'+eyes+'%，让眼睛更有神');
    var teeth=parseInt(v.teeth)||0; if(teeth>0)items.push('美白牙齿程度约'+teeth+'%，保持自然');
    if(v.oil)items.push('去除面部油光，保留自然高光');
    if(v.hair)items.push('整理额头与两侧碎发，发际线干净');
    var slim=parseInt(v.slim)||0;
    if(slim>0){ if(slim<=20)items.push('轻微收窄脸型与下颌线，保持原有脸型特征');
      else if(slim<=40)items.push('适度优化脸部轮廓，保持五官比例与身份特征');
      else items.push('明显瘦脸并优化下颌线，但不得改变五官比例与身份特征'); }
    if(v.bg_blur)items.push('背景轻微虚化，突出人物主体');
    if(items.length)parts.push(items.join('；'));
    if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
    return join(parts);
  }
  function styleOutfitText(v){
    var o=v.outfit||'按风格自动搭配';
    if(o==='保持原服装') return '服装保持原照片中的服装、颜色和款式不变，不要因为风格而更换服装';
    if(o==='自定义服装描述…'){
      var custom=(v.outfit_custom||'').trim();
      return custom ? ('服装必须改为：'+custom+'，替换原服装，并与整体风格协调') : '服装与发型按该风格自动搭配，协调统一';
    }
    if(o==='按风格自动搭配'||o==='自动选择得体服装') return '服装与发型按该风格自动搭配，替换原服装，协调统一';
    var desc=o.indexOf('｜')>=0?o.split('｜')[1]:o;
    return '服装必须改为：'+desc+'，替换原服装，并与整体风格协调；不要出现原服装或其他服装';
  }
  function stylePrompt(v){
    var desc=STYLE_PRESETS[v.preset]||((v.custom||'').trim()||v.preset||'自定义风格');
    var outfit=styleOutfitText(v);
    var parts=['把这张照片转换为以下风格：'+desc,
      '保持人物的长相、神态、姿势和构图不变，转换后仍是同一个人',
      '服装要求优先于风格默认：'+outfit];
    var level=Math.max(0,Math.min(100,parseInt(v.strength)||0));
    if(level<=30)parts.push('风格强度较低：保留原照片的色调与质感，只轻微融入风格元素');
    else if(level<=60)parts.push('风格强度中等：明显融入风格特征，同时保留真实照片质感');
    else if(level<=85)parts.push('风格强度较高：整体呈现该风格的色调、光影与质感');
    else parts.push('风格强度很高：强烈的艺术化处理，画面以风格表达为主');
    parts.push(outfit);
    parts.push('画面协调自然，细节精致，高质量');
    if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
    return join(parts);
  }
  function restorePrompt(v){
    var parts=['修复这张老照片，让它恢复清晰干净'];
    var level={'轻度':'修复程度：轻度，只处理最明显的瑕疵，保留年代感',
      '标准':'修复程度：标准，清理瑕疵并适度增强细节',
      '强力':'修复程度：强力，尽可能恢复清晰度与完整度'}[v.strength]; if(level)parts.push(level);
    var actions=[];
    if(v.scratch)actions.push('去除划痕、折痕、污渍、霉斑和噪点');
    if(v.damage)actions.push('自然补全破损缺失的区域，不改变人物特征');
    if(v.upscale)actions.push('提升清晰度和细节（去模糊、增强纹理），但不要生成不存在的五官');
    if(actions.length)parts.push(actions.join('；'));
    var denoise=parseInt(v.denoise)||0; if(denoise>0)parts.push('降噪强度约'+denoise+'%，在去噪的同时保留人物五官与发丝细节');
    if(v.face)parts.push('重点增强面部五官细节，眼睛、眉毛和嘴唇清晰自然');
    if(v.colorize)parts.push('为照片自然上色：肤色、服装和环境颜色符合照片年代特征与现实常识，色彩柔和真实不夸张');
    parts.push('保持人物原貌、表情、姿势和构图不变，修复结果像同一张照片的原底冲洗');
    if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
    return join(parts);
  }
  function outpaintPrompt(v){
    var labels={'3:4':'3:4 竖版','4:3':'4:3 横版','1:1':'1:1 方形','16:9':'16:9 宽幅',
      '9:16':'9:16 竖屏','3:2':'3:2','2:3':'2:3','21:9':'21:9 全景'};
    var parts=['在保持原图内容不变的前提下，把画面自然向外扩展为 '+(labels[v.ratio]||v.ratio)+' 的画幅',
      '新增画面的扩展方向：'+(v.direction||'四周均匀扩展'),
      '原图内容不裁切、不缩放，主体保持自然的位置与比例',
      '新增的画面内容与原图的场景、透视关系、光线方向和色彩风格无缝衔接，过渡自然，没有明显拼接痕迹',
      '不出现重复的人物、扭曲的肢体或突兀的物体'];
    if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
    return join(parts);
  }
  function generatePrompt(v){
    var parts=[professionalizePrompt(v.prompt||'').replace(/。+$/,'')];
    if(GEN_STYLES[v.style])parts.push(GEN_STYLES[v.style]);
    parts.push('画面清晰，细节丰富，构图完整，高质量');
    if((v.negative||'').trim())parts.push('避免出现：'+cleanText(v.negative).replace(/。+$/,''));
    return parts.filter(Boolean).join('。').replace(/。+$/,'')+'。';
  }
  function parseFactor(text){
    var m=String(text||'2').match(/([0-9]+(?:\.[0-9]+)?)/);
    var f=m?parseFloat(m[1]):2;
    return Math.max(1,Math.min(8,f));
  }
  function cleanText(s){
    return String(s||'')
      .replace(/\r/g,'')
      .replace(/[ \t]+/g,' ')
      .replace(/\s*([，,、；;。！!？?])\s*/g,'$1')
      .replace(/[，,、；;]+/g,'，')
      .replace(/。+/g,'。')
      .replace(/^[，,。；;、\s]+|[，,。；;、\s]+$/g,'')
      .trim();
  }
  function splitClauses(text){
    return cleanText(text).split(/[，,、；;。\n]+/)
      .map(function(x){return x.trim();}).filter(Boolean);
  }
  function dedupe(arr){
    var seen={}, out=[];
    arr.forEach(function(x){
      var k=x.replace(/\s/g,'');
      if(k && !seen[k]){seen[k]=1;out.push(x);}
    });
    return out;
  }
  function hasAny(text, words){
    for(var i=0;i<words.length;i++) if(text.indexOf(words[i])>=0) return true;
    return false;
  }
  /** 把口语化、顺序混乱的描述整理成结构化专业提示词。 */
  function professionalizePrompt(text){
    var raw=cleanText(text);
    if(!raw) return '';
    if(/^(主体|画面主体)[：:]/.test(raw) || /；场景[：:]/.test(raw)) {
      return raw.replace(/。+$/,'')+'。';
    }
    var clauses=dedupe(splitClauses(raw));
    var buckets={subject:[],scene:[],light:[],style:[],composition:[],quality:[],detail:[]};
    clauses.forEach(function(c){
      if(hasAny(c,['光','逆光','侧光','柔光','灯光','阳光','阴影','霓虹','曝光','补光'])) buckets.light.push(c);
      else if(hasAny(c,['背景','场景','街道','城市','森林','海边','室内','房间','花园','雪','雨','天空','草原','桌面','影棚','虚化背景'])) buckets.scene.push(c);
      else if(hasAny(c,['构图','特写','全景','俯视','仰视','景深','虚化','居中','留白','视角','镜头'])) buckets.composition.push(c);
      else if(hasAny(c,['风格','摄影','写实','电影','动漫','插画','油画','水墨','3D','赛博','复古','胶片','质感','色调'])) buckets.style.push(c);
      else if(hasAny(c,['高清','清晰','细节','画质','4K','8K','锐利','精致','高质量'])) buckets.quality.push(c);
      else if(hasAny(c,['人物','女孩','男孩','男人','女人','老人','孩子','猫','狗','狐狸','动物','商品','产品','汽车','建筑','花','树','山','海','主体'])) buckets.subject.push(c);
      else buckets.detail.push(c);
    });
    var parts=[];
    if(buckets.subject.length)parts.push('主体：'+buckets.subject.join('，'));
    if(buckets.scene.length)parts.push('场景：'+buckets.scene.join('，'));
    if(buckets.light.length)parts.push('光线：'+buckets.light.join('，'));
    if(buckets.composition.length)parts.push('构图：'+buckets.composition.join('，'));
    if(buckets.style.length)parts.push('风格：'+buckets.style.join('，'));
    if(buckets.detail.length)parts.push('画面细节：'+buckets.detail.join('，'));
    if(buckets.quality.length)parts.push('画质：'+buckets.quality.join('，'));
    parts.push('画面协调自然，细节丰富，高质量');
    return parts.join('；')+'。';
  }
  /** 一键规范：按字段类型补全成可直接使用的专业描述。 */
  function normalizeField(op, key, text){
    var raw=cleanText(text);
    if(!raw) return '';
    if(key==='outfit_custom')
      return '服装为'+raw+'，剪裁合身、整洁得体，符合证件照着装规范。';
    if(key==='hair_custom')
      return '发型 / 发色为'+raw+'，发丝自然、整洁有层次，露出额头和眉毛。';
    if(key==='custom'){
      if(op==='style') return '整体风格为'+raw+'，色调统一、质感自然，人物五官清晰。';
      if(op==='cutout') return '背景为'+raw+'，光线柔和、透视自然、干净无杂物。';
      return '背景为'+raw+'，光线柔和、透视自然、干净无杂物。';
    }
    if(key==='extra') return '补充要求：'+raw+'。';
    if(key==='negative') return dedupe(splitClauses(raw)).join('，')+'。';
    if(key==='remove') return '去除'+raw+'，去除区域用周围环境自然填补，不留修补痕迹。';
    if(key==='keep') return '严格保留'+raw+'，保持原样不变。';
    if(key==='desc') return '商品卖点：'+raw+'，突出材质、颜色与使用场景。';
    if(key==='prompt') return professionalizePrompt(raw);
    return raw.replace(/。+$/,'')+'。';
  }

  function build(op, v){
    switch(op){
      case 'upscale': {
        var mode=v.mode||'AI 细节增强（推荐）';
        var factor=parseFactor(v.factor);
        if(mode.indexOf('本地')>=0){
          return {prompt:'本地无损放大 '+v.factor+'（不调用 AI，只提升分辨率）',
            local:true, factor:factor};
        }
        var det=parseInt(v.detail)||70;
        var parts=['把这张图片高清放大 '+v.factor+'，提升分辨率与清晰度',
          '细节增强程度约 '+det+'%，保留并增强真实纹理，不要产生塑料感或过度锐化'];
        if(v.face)parts.push('重点增强面部五官细节，眼睛、眉毛、嘴唇清晰自然');
        parts.push('保持原图内容、构图、色彩和人物身份完全不变');
        if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
        return {prompt:join(parts), local:false, factor:factor};
      }
      case 'cutout': {
        var bg=v.bg||'透明背景';
        var transparent=bg==='透明背景';
        var bgtxt;
        if(transparent) bgtxt='纯白色（#FFFFFF）干净背景（这是中间步骤，稍后本地程序会把它变成透明）';
        else if(bg==='自定义描述') bgtxt=(v.custom||'').trim()||'纯白色干净背景';
        else if(bg==='自定义颜色') bgtxt='纯色背景（'+(v.color||'#FFFFFF')+'）';
        else bgtxt=bg;
        var parts=['把图片中的主体人物或物体精确抠出，背景替换为：'+bgtxt,
          '保留主体的外貌、姿势、服装和细节完全不变'];
        if(v.edge)parts.push('精细保留发丝与衣物边缘，不要抠掉头发，不要产生白边、锯齿或抠图残影');
        if(transparent)parts.push('主体边缘尽量远离画布边缘，背景为均匀纯净的白色，不要添加阴影或渐变，便于本地程序抠除白色背景并输出透明 PNG');
        if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
        return {prompt:join(parts), transparent:transparent,
          bgHex:bg==='自定义颜色'?(v.color||'#FFFFFF'):null};
      }
      case 'colorize': {
        var st=parseInt(v.strength)||80;
        var parts=['为这张黑白老照片自然上色',
          '上色风格：'+(v.style||'自然真实'),
          '上色强度约 '+st+'%，肤色、服装与环境颜色符合照片年代与现实常识，色彩柔和真实不夸张'];
        if(v.face)parts.push('人物肤色自然真实，优先保证面部颜色准确');
        parts.push('保持原图的构图、人物、表情和细节不变，不生成不存在的内容');
        if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
        return {prompt:join(parts)};
      }
      case 'inpaint': {
        var parts=['智能局部修复这张图片：只修改指定区域，其余部分保持原图不变'];
        if((v.remove||'').trim())parts.push('必须去除：'+cleanText(v.remove));
        if((v.keep||'').trim())parts.push('严格保留：'+cleanText(v.keep));
        parts.push('去除区域使用周围内容自然填充，光影、透视和色彩与原图无缝衔接，不留修补痕迹');
        parts.push('不要更换整张图的背景、构图、服装、人物身份或整体色调');
        if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
        if((v.remove||'').trim())parts.push('再次确认：必须去除'+cleanText(v.remove)+'，其他区域保持不变');
        return {prompt:join(parts)};
      }
      case 'product': {
        var purpose=PRODUCT_PURPOSE[v.purpose]||PRODUCT_PURPOSE['电商主图 1:1'];
        var scene=PRODUCT_SCENES[v.scene]||v.scene||PRODUCT_SCENES['纯白影棚'];
        var parts=['以图片中的商品为唯一主体，制作一张可直接用于电商展示的专业商品图',
          '场景与背景：'+scene,
          '输出用途：'+purpose.label+'（'+purpose.ratio+' 画幅）',
          '布光方式：'+(v.light||'柔和商业布光')];
        if((v.name||'').trim())parts.push('商品名称 / 类型：'+cleanText(v.name));
        if((v.desc||'').trim())parts.push('商品卖点：'+cleanText(v.desc));
        if(v.shadow)parts.push('添加自然的接触阴影，让商品有立体感、不悬浮');
        parts.push('商品主体完整居中，占画面约 70%，不变形、不改变颜色和材质',
          '细节锐利，色彩准确，商业摄影质感，背景干净无杂物，不添加任何文字和水印');
        if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
        return {prompt:join(parts), purpose:purpose};
      }
      case 'avatar': {
        var styles={'日系动漫':'日系动漫插画风格，干净线稿，赛璐璐上色，清透明亮',
          '3D 卡通':'3D 卡通渲染风格，柔和材质，皮克斯质感，立体可爱',
          '像素风':'复古像素游戏风格，16bit 像素画，方块化色彩',
          '水墨国风':'中国水墨画风格，宣纸质感，墨色晕染，东方意境',
          '手绘插画':'温柔手绘插画风格，柔和笔触，治愈色调',
          '职场插画':'扁平化职场插画风格，简洁几何，商务配色'};
        var parts=['把照片中的人物转换为以下头像风格：'+(styles[v.style]||v.style||'动漫风格')];
        if(v.keep)parts.push('严格保持人物长相、五官特征和发型，转换后仍是同一个人');
        parts.push('头部居中，构图适合作为社交头像，背景简洁，画面精致');
        if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
        return {prompt:join(parts)};
      }
      case 'idphoto': {
        var spec=resolveSpec(v), ts=v.type?specForType(v.type):null;
        if(v.type==='自定义尺寸'){
          spec=resolveSpec({spec:'自定义尺寸',width:v.width,height:v.height,dpi:v.dpi});
        } else if((!v.spec || v.spec==='一寸') && ts && ts!=='自定义尺寸'){
          for(var i=0;i<ID_SPECS.length;i++) if(ID_SPECS[i].label===ts){spec=ID_SPECS[i];break;}
        }
        return {prompt:idPrompt(spec,v), spec:spec};
      }
      case 'background': return {prompt:bgreplacePrompt(v)};
      case 'inpaint': {
        var parts=['智能局部修复这张图片：只修改指定区域，其余部分保持原图不变'];
        if((v.remove||'').trim())parts.push('必须去除：'+cleanText(v.remove));
        if((v.keep||'').trim())parts.push('严格保留：'+cleanText(v.keep));
        parts.push('去除区域使用周围内容自然填充，光影、透视和色彩与原图无缝衔接，不留修补痕迹');
        parts.push('不要更换整张图的背景、构图、服装、人物身份或整体色调');
        if((v.extra||'').trim())parts.push('补充要求：'+cleanText(v.extra));
        if((v.remove||'').trim())parts.push('再次确认：必须去除'+cleanText(v.remove)+'，其他区域保持不变');
        return {prompt:join(parts)};
      }
      case 'retouch': return {prompt:retouchPrompt(v)};
      case 'style': return {prompt:stylePrompt(v)};
      case 'restore': return {prompt:restorePrompt(v)};
      case 'outpaint': return {prompt:outpaintPrompt(v)};
      case 'generate': return {prompt:generatePrompt(v)};
      default: return {prompt:(v.extra||'').trim()};
    }
  }
  function layoutInfo(v){
    var layout=v.layout||'不排版（仅单张）';
    var map={
      '6寸相纸｜自动铺满':{w:1795,h:1205,count:0,label:'6寸相纸'},
      '6寸相纸｜指定张数':{w:1795,h:1205,count:parseInt(v.sheet)||9,label:'6寸相纸'},
      '5寸相纸｜自动铺满':{w:1500,h:1050,count:0,label:'5寸相纸'},
      'A4相纸｜9张':{w:2480,h:3508,count:9,label:'A4相纸'},
      'A4相纸｜12张':{w:2480,h:3508,count:12,label:'A4相纸'}
    };
    return map[layout]||null;
  }
  global.Prompts={ build:build, closestRatio:closestRatio, resolveSpec:resolveSpec,
    specForType:specForType, layoutInfo:layoutInfo, ID_SPECS:ID_SPECS,
    idBgHex:idBgHex, parseFactor:parseFactor, cleanText:cleanText,
    professionalizePrompt:professionalizePrompt, normalizeField:normalizeField,
    PRODUCT_PURPOSE:PRODUCT_PURPOSE, PRODUCT_SCENES:PRODUCT_SCENES };
})(window);
