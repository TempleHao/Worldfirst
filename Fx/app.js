/* Worldfirst / Fx · 7-day verified-source reading and interactive mechanism teaching */
"use strict";
const $ = id => document.getElementById(id);
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const app = { data:null, items:[], selectedId:null, query:"", pair:"", topic:"", scenario:"hawk", ai:null };
function htmlEsc(x){ return String(x ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch])); }
function safeURL(x){ try { const u = new URL(String(x)); return ["http:","https:"].includes(u.protocol) ? u.href : "#"; } catch { return "#"; } }
function toDate(x){const n=Date.parse(x); return Number.isFinite(n)?n:NaN;}
function within7(a){const stamp=toDate(a.published_at);const elapsed=Date.now()-stamp;return Number.isFinite(stamp)&&elapsed>=0&&elapsed<=WINDOW_MS;}
const fmtDay = new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit"});
const fmtTime = new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hour12:false});
const fmtFull = new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
function printable(stamp,f=fmtFull){const d=new Date(stamp);return Number.isFinite(d.getTime())?f.format(d):"未标日期";}
function labelFor(a){return a.verification==="official"?"官方原始发布":"单源媒体资讯";}
function pairsFor(a){return Array.isArray(a.pairs)?a.pairs.map(String):[];}
function distinctTopics(){return [...new Set(app.items.map(a=>String(a.topic||"其他")))].sort();}
function publishStatus(){const updated=toDate(app.data?.updated_at);return Number.isFinite(updated)&&Date.now()-updated>=0&&Date.now()-updated<=3*3600000;}
const mechanics={
  "货币政策":{
    headline:"政策措辞如何进入汇率价格",
    overview:"央行决议、官员讲话和市场解读需要分开阅读。利率通常影响货币吸引力，但真正推动价格变化的往往是政策信号与原有预期之间的差异。",
    chain:["政策或官员表态","未来利率预期调整","利差与资产需求改变","汇率可能重新定价"],
    checks:"请核对央行原文、新闻发布时点、决策前市场预期、国债收益率及主要货币对在相同时间窗口的变化。",
    opposite:"如果市场已经提前消化、其他央行变化更大，或避险需求主导交易，方向可能不同。"
  },
  "通胀与就业":{
    headline:"为什么市场更在意“预期差”",
    overview:"通胀、就业数据的影响要对照公布值、市场预期和历史修订值。数据本身不是美元方向的充分理由。",
    chain:["公布经济数据","与市场预期作比较","重新评估央行政策路径","利率与外汇可能受到影响"],
    checks:"确认统计机构、公布时间、统计口径、实际值、预期值以及前值是否修订。",
    opposite:"即使数据高于预期，市场也可能关注其中的结构问题，或者已有其他更强的风险因素。"
  },
  "人民币":{
    headline:"理解 USD/CNY、USD/CNH 与人民币强弱",
    overview:"人民币分析要明确是美元兑人民币，还是人民币兑美元；在岸 CNY、离岸 CNH、中间价也有不同形成机制。",
    chain:["国内外利率及贸易变化","结售汇与资金流预期","在岸/离岸报价调整","企业收付汇成本改变"],
    checks:"区分 USD/CNY 和 USD/CNH，确认数据时点、人民银行官方公告和具体报价方向。",
    opposite:"USD/CNY 上升意味着同样一美元可兑换更多人民币。贸易流、结售汇和预期管理均可能令短期表现偏离简单的利差逻辑。"
  },
  "港币机制":{
    headline:"联系汇率制度下，哪些变量更重要",
    overview:"港币处于联系汇率安排之下，美元与港元的关系应从制度、兑换保证、金管局操作以及港元利率来理解。",
    chain:["美元与港元利率差变化","资金配置与港元需求","港元汇率触及区间边缘的可能性","货币基础与银行体系流动性变化"],
    checks:"核对香港金管局资料、官方兑换保证和银行体系总结余；区分机制解释与真正已经发生的操作。",
    opposite:"港币联系汇率制度约束了汇率区间，但不意味着利率差能无风险持续套利；融资、交易成本和市场安排很重要。"
  },
  "外汇市场":{
    headline:"汇率为什么不会只由一条新闻决定",
    overview:"一则汇市新闻通常同时涉及利差、经济预期、风险情绪、资金流和政策信号。需要区分记者描述、机构预测与可核实的报价事实。",
    chain:["消息或预期变化","市场参与者重新定价","资金配置及流动性反应","特定货币对变化"],
    checks:"查看报价方向、数据提供者、时间、相关资产与市场背景；不要把新闻标题当作可验证因果。",
    opposite:"不同货币对的计价方向不同，风险偏好、避险需求、流动性与已有仓位也可能使汇率与单一宏观叙事背离。"
  },
  "宏观经济":{
    headline:"宏观信息如何传到外汇市场",
    overview:"增长、财政、债券收益率与贸易变化都可能影响汇率，但需要识别是否真的改变了相对增长和利率预期。",
    chain:["宏观数据与政策变化","增长或财政预期调整","收益率与资金流变化","汇率与跨境经营影响"],
    checks:"查看官方统计与修订、经济周期、市场预期和同期间替代解释。",
    opposite:"强劲经济数据未必必然推升货币；若通胀、财政风险或其他国家走势更强，结果可能不同。"
  },
  "其他":{
    headline:"先确定事实，再判断关联",
    overview:"这条消息的货币影响尚未被结构化核实。可以先阅读原始发布，再判断其与利率、增长、风险预期或资金流动的关系。",
    chain:["核对原始发布","确定影响变量","寻找独立数据","保留尚未证实的部分"],
    checks:"检查原始链接、发布者、时间和证据是否可追溯。",
    opposite:"目前不能根据标题推断货币涨跌或市场已经作出的反应。"
  }
};
const scenarios={
  hawk:{
    name:"偏鹰信号 / 示例",
    chain:["政策表态偏鹰","市场可能上修美国利率预期","相对利差可能扩大","美元可能获得支撑"],
    explain:"假设美联储释放的信息比市场此前预期更强调控制通胀，投资者可能重新评估未来降息幅度。与其他国家相比，美国资产收益率的变化会影响美元需求。",
    counter:"如果偏鹰内容早已被充分定价，或市场突然更担心衰退和金融风险，美元不一定按照简单的利差逻辑变化。"
  },
  inflation:{
    name:"通胀低于预期 / 示例",
    chain:["实际 CPI 低于市场预期","未来政策利率预期可能下降","美元资产相对收益率可能走弱","美元可能承压"],
    explain:"同一个通胀数字，只有放在预期、修订和市场原有定价中才有意义。低于预期可能改变投资者对未来政策路径的理解。",
    counter:"市场可能早已预计通胀降温；核心通胀结构、其他经济数据、风险偏好及其他央行政策都可能改变最终市场反应。"
  },
  receivable:{
    name:"美元收款 / 示例",
    chain:["企业收到 100,000 美元","假设 USD/CNY 由 7.20 降到 7.00","若全部结汇：720,000 元 → 700,000 元","账面人民币收入差额 −20,000 元"],
    explain:"这是纯算术情景：一美元能兑换的人民币减少，同样的美元收入转换成人民币就变少。这里未计手续费、锁汇成本及实际交易价。",
    counter:"企业可能已有美元负债、外币成本、自然对冲或远期锁汇安排，因此不能只凭这一笔结汇差额判断经营损益。"
  }
};

function mechanismFor(a){
  if(pairsFor(a).includes("USD/JPY")&&/干预|intervention|160|日元/.test(a.title)){
    return {
      headline:"为什么外汇干预风险可能改变市场预期",
      overview:"日元新闻需要区分三件事：官员的口头警告、市场对干预概率的判断、已经发生的实际外汇干预。即使三者同时受到讨论，也不表示未来汇率方向已经确定。",
      chain:["USD/JPY 与利差变化","日本当局表达关注","市场调整干预概率","日元可能出现双向波动"],
      checks:"优先核对日本财务省、央行官方记录；再检查相关新闻的发布时间、美元兑日元报价方向、真实干预操作是否披露以及美日利率预期。",
      opposite:"若美日利差与其他基本面继续偏向美元，日元可能在口头警告后仍走弱；实际干预也不必然带来长期趋势反转。"
    };
  }
  return mechanics[a.topic]||mechanics["其他"];
}
function renderScenario(){
  const s=scenarios[app.scenario];$("scenario-name").textContent=s.name;
  $("scenario-chain").innerHTML=s.chain.map((v,i)=>'<div class="chain-step"><small>0'+(i+1)+'</small>'+htmlEsc(v)+'</div>').join("");
  $("scenario-explain").textContent=s.explain;$("scenario-counter").textContent=s.counter;
  document.querySelectorAll("[data-scenario]").forEach(el=>{const active=el.dataset.scenario===app.scenario;el.classList.toggle("active",active);el.setAttribute("aria-pressed",String(active));});
}
function getLead(){
  // Transparent deterministic editorial ranking; this is not a model judgment.
  const ranked=app.items.map(a=>{
    const title=String(a.title||"");
    const age=(Date.now()-toDate(a.published_at))/3600000;
    let score=Math.max(0,8-age/21);
    if(/干预|intervention|汇率干预|160关口/i.test(title))score+=16;
    if(/美联储|利率|国债收益率|央行|通胀|CPI|加息|降息|interest rate|monetary policy/i.test(title))score+=7;
    if(/美元|日元|人民币|港币|英镑|欧元|汇率|外汇|yen|dollar|exchange rate/i.test(title))score+=4;
    if(/[\u3400-\u9fff]/.test(title))score+=5; // Favor immediately readable Chinese material.
    if(a.verification==="official")score+=2;
    if(/tentative schedule|meeting schedule|future of ai|digital euro|research conference|cash and the/i.test(title))score-=35;
    if(/走势预测|forecast|technical analysis/i.test(title))score-=7;
    return {a,score};
  }).sort((x,y)=>y.score-x.score);
  return ranked[0]?.a||null;
}
function renderLead(){
  const a=getLead(),wrap=$("lead-content");
  if(!a){wrap.innerHTML='<div class="empty"><strong>最近七天暂无可展示的有效新闻</strong>系统只展示有可核验发布时间的 RSS 信息。请查看连接状态；不会用过期消息填充本周焦点。</div>';return;}
  const m=mechanismFor(a);
  wrap.innerHTML='<div class="feature-origin"><em>'+htmlEsc(a.topic||"其他")+'</em><span>'+htmlEsc(printable(a.published_at))+'（北京）</span><span>'+htmlEsc(a.source)+'</span></div>'+
    '<h2>'+htmlEsc(a.title)+'</h2>'+
    '<p class="context"><strong>为什么值得理解：</strong>'+htmlEsc(m.overview)+'<br><small>此处是对应主题的通用机制，不代表已经核实该事件对汇率的实际影响。</small></p>'+
    '<div class="feature-actions"><button type="button" class="action-primary" data-select="'+htmlEsc(a.id)+'">逐步拆解这条信息 ↗</button><a class="action-secondary" href="'+htmlEsc(safeURL(a.url))+'" target="_blank" rel="noopener noreferrer">查看原始来源 ↗</a></div>';
}
function renderBars(){
  const counts={};app.items.forEach(a=>counts[a.topic||"其他"]=(counts[a.topic||"其他"]||0)+1);
  const entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5),max=Math.max(1,...entries.map(x=>x[1]));
  $("topic-bars").innerHTML=entries.length?entries.map(([name,n])=>'<div class="bar-line"><span>'+htmlEsc(name)+'</span><div class="bar-track"><i style="width:'+Math.max(3,Math.round(n*100/max))+'%"></i></div><b>'+n+'</b></div>').join(""):'<p class="muted">最近七天暂无主题分布。</p>';
}
function renderOverview(){
  $("week-period").textContent=fmtDay.format(new Date(Date.now()-WINDOW_MS))+" — "+fmtDay.format(new Date())+" / 北京";
  $("metric-events").textContent=String(app.items.length);
  const sources=Array.isArray(app.data?.sources)?app.data.sources:[];
  const ok=sources.filter(x=>x.ok).length;
  $("metric-sources").textContent=sources.length?ok+"/"+sources.length:"0";
  $("last-sync").textContent=printable(app.data?.updated_at);
  $("source-line").textContent="最近七天收录 "+app.items.length+" 条 / "+ok+" 个可连接信息源";
  const live=publishStatus(); $("state-dot").classList.toggle("ok",live);
  $("system-state").textContent=live?"最近采集有效":"数据更新状态待检查";
  $("footer-coverage").textContent="滚动 7×24 小时窗口 · "+app.items.length+" 条有效信息";
  renderLead();renderBars();
}
function renderOptions(){
  const sel=$("topic"),current=app.topic;sel.replaceChildren();
  const all=document.createElement("option");all.value="";all.textContent="全部";sel.appendChild(all);
  distinctTopics().forEach(t=>{const opt=document.createElement("option");opt.value=t;opt.textContent=t;sel.appendChild(opt)});
  sel.value=current;
}
function articleMatches(a){
  const phrase=app.query.trim().toLocaleLowerCase("zh-CN"),allText=[a.title,a.source,a.topic, ...pairsFor(a)].join(" ").toLocaleLowerCase("zh-CN");
  return (!phrase||allText.includes(phrase))&&(!app.topic||a.topic===app.topic)&&(!app.pair||pairsFor(a).includes(app.pair));
}
function articleMarkup(a,i){
  const subject=a.topic||"其他",selected=a.id===app.selectedId;const link=safeURL(a.url);
  return '<article class="article-row'+(selected?' selected':'')+'" data-article-id="'+htmlEsc(a.id)+'">'+
    '<div class="article-time"><strong>'+htmlEsc(printable(a.published_at,fmtDay))+'</strong><span>'+htmlEsc(printable(a.published_at,fmtTime))+'</span></div>'+
    '<div class="article-content"><div class="article-tags"><span class="topic">'+htmlEsc(subject)+'</span><span class="divider-dot"></span><span>'+htmlEsc(labelFor(a))+'</span>'+
    (pairsFor(a).length?'<span class="divider-dot"></span><span>'+pairsFor(a).slice(0,2).map(htmlEsc).join(" / ")+'</span>':"")+'</div>'+
    '<h3>'+htmlEsc(a.title)+'</h3><p>'+htmlEsc(a.source)+'</p></div>'+
    '<div class="article-control"><button class="read-button" type="button" data-select="'+htmlEsc(a.id)+'" aria-label="理解这条新闻：'+htmlEsc(a.title)+'">解读 ↗</button><a class="source-link" href="'+htmlEsc(link)+'" target="_blank" rel="noopener noreferrer">原文 ↗</a></div></article>';
}
function renderNews(){
  const visible=app.items.filter(articleMatches);
  $("article-list").innerHTML=visible.length?visible.map(articleMarkup).join(""):'<div class="empty"><strong>最近七天没有符合筛选的资讯</strong>尝试搜索其他主题或取消筛选。系统不会填入旧消息或演示新闻。</div>';
  $("feed-foot-count").textContent="显示 "+visible.length+" / "+app.items.length+" 条 · 仅最近七天";
}
function renderTeaching(){
  const a=app.items.find(x=>x.id===app.selectedId),root=$("teaching-content");
  if(!a){root.innerHTML='<div class="empty"><strong>先读一条真实消息。</strong>点击左侧新闻的“解读”，这里就会展示它涉及的汇率机制和核验清单。</div>';return;}
  const m=mechanismFor(a);
  root.innerHTML='<div class="chosen-source">'+htmlEsc(a.source)+' / '+htmlEsc(printable(a.published_at))+'</div>'+
    '<h3 class="chosen-title">'+htmlEsc(a.title)+'</h3>'+
    '<div class="lesson-section"><span class="lesson-label">01 / 背景概念</span><p>'+htmlEsc(m.overview)+'</p></div>'+
    '<div class="lesson-section"><span class="lesson-label">02 / 条件传导 · 教学示意</span><div class="lesson-chain">'+m.chain.map((v,i)=>(i?'<i>→</i>':'')+'<span>'+htmlEsc(v)+'</span>').join("")+'</div></div>'+
    '<div class="lesson-section"><span class="lesson-label">03 / 这条新闻还需核对什么</span><p>'+htmlEsc(m.checks)+'</p></div>'+
    '<div class="lesson-section"><span class="lesson-label">04 / 为什么可能出现相反结果</span><p>'+htmlEsc(m.opposite)+'</p></div>'+
    '<div class="lesson-section"><span class="lesson-label">审稿状态</span><p>新闻标题与来源可追溯；以上是主题机制讲解，尚未完成该事件的独立 AI 因果核验。</p><a class="lesson-source" href="'+htmlEsc(safeURL(a.url))+'" target="_blank" rel="noopener noreferrer">核对新闻原文 ↗</a></div>';
  const reviewed=Array.isArray(app.ai?.claims)?app.ai.claims.filter(c=>c.evidence_ids.includes(a.id)):[];
  if(reviewed.length){
    root.insertAdjacentHTML("beforeend",'<div class="lesson-section"><span class="lesson-label">05 / AI 事实审稿 · 已有证据</span>'+
      reviewed.slice(0,3).map(c=>'<p style="margin-bottom:12px">'+htmlEsc(c.statement)+'<br><small>'+htmlEsc(c.type)+' / '+htmlEsc(c.grade)+' · 审稿时间 '+htmlEsc(printable(app.ai.generated_at))+'</small></p>').join("")+
      '</div>');
  }
}
function selectArticle(id){
  if(!app.items.some(a=>a.id===id))return;
  app.selectedId=id;renderNews();renderTeaching();
  const target=$("reader"),screen=window.matchMedia("(max-width:850px)").matches;
  if(screen)target.scrollIntoView({behavior:"smooth",block:"start"});
}
async function load(){
  try{
    const r=await fetch("./data/articles.json?t="+Date.now(),{cache:"no-store"});
    if(!r.ok)throw Error("HTTP "+r.status);
    const d=await r.json();
    if(!d||!Array.isArray(d.articles))throw Error("资讯结构不符合协议");
    app.data=d;
    app.items=d.articles.filter(within7).sort((a,b)=>toDate(b.published_at)-toDate(a.published_at));
    app.ai=null;
    try {
      const aiResponse=await fetch("./data/ai-brief.json?t="+Date.now(),{cache:"no-store"});
      if(aiResponse.ok){
        const brief=await aiResponse.json();
        const validIds=new Set(app.items.map(x=>x.id));
        const validClaim=c=>c&&["F","O","I","X","U"].includes(c.type)&&
          ["P0","P1","P2","P3","C","U"].includes(c.grade)&&typeof c.statement==="string"&&
          Array.isArray(c.evidence_ids)&&c.evidence_ids.length>0&&c.evidence_ids.every(id=>validIds.has(id));
        const stamp=toDate(brief.generated_at),age=Date.now()-stamp;
        if(brief.schema_version===1&&brief.reviewed===true&&brief.method==="chatgpt_review_with_cited_sources"&&
          Number.isFinite(stamp)&&age>=0&&age<=26*3600000&&
          Array.isArray(brief.claims)&&brief.claims.length>0&&brief.claims.every(validClaim))app.ai=brief;
      }
    } catch { app.ai=null; }
    if(!app.items.some(a=>a.id===app.selectedId))app.selectedId=getLead()?.id||null;
    renderOverview();renderOptions();renderNews();renderTeaching();
  }catch(e){
    app.data={updated_at:null,sources:[]};app.items=[];app.selectedId=null;
    renderOverview();renderOptions();renderNews();renderTeaching();
    $("article-list").insertAdjacentHTML("afterbegin",'<div class="alert">RSS 快照读取失败：'+htmlEsc(e.message)+'。请查看 GitHub Actions。没有使用任何演示新闻填充。</div>');
  }
}
function init(){
 $("search").addEventListener("input",e=>{app.query=e.target.value;renderNews()});
 $("pair").addEventListener("change",e=>{app.pair=e.target.value;renderNews()});
 $("topic").addEventListener("change",e=>{app.topic=e.target.value;renderNews()});
 $("reset-filter").addEventListener("click",()=>{app.query="";app.pair="";app.topic="";$("search").value="";$("pair").value="";$("topic").value="";renderNews()});
 document.addEventListener("click",e=>{
   const scenario=e.target.closest("[data-scenario]");
   if(scenario){if(scenarios[scenario.dataset.scenario]){app.scenario=scenario.dataset.scenario;renderScenario()}return;}
   const link=e.target.closest("[data-select]");
   if(link){selectArticle(link.dataset.select);return;}
 });
 renderScenario();load();
}
init();