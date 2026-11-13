/* 外汇内参 / 冷峻金融资讯界面：所有行情和新闻均来自已发布的来源快照。 */
"use strict";
const $=id=>document.getElementById(id);
const SEVEN=7*24*60*60*1000;
const state={
  raw:[],editorial:{},brief:null,market:[],marketSources:[],
  newsSources:[],newsUpdated:null,marketUpdated:null,
  filter:"all",query:"",limit:12,selectedPair:"USD/CNY",
  busy:false,imageFailed:false,loadError:null
};
const ZH={
  "b2851de93965f784":"欧洲央行施纳贝尔发表《欧洲制造》主题讲话",
  "87a784bdd6110f05":"美联储修订2027年FOMC会议暂定日程",
  "0040329e474488dc":"美联储鲍曼谈美国经济与货币政策的考量",
  "e3471b85e9068b8b":"欧洲央行莱恩谈货币政策沟通的科学与实践",
  "461728c10cfa467f":"欧洲央行奇波洛内谈现金与数字欧元",
  "7e8ebfec1b135b15":"美联储沃勒谈经济展望与劳动力市场",
  "b9dcd2ec49851590":"欧洲央行行长拉加德接受《读卖新闻》采访"
};
const clockFmt=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
const dayFmt=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
const timeFmt=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hour12:false});
function esc(t){return String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function safeURL(u){try{const url=new URL(String(u));return /^https?:$/.test(url.protocol)?url.href:"#";}catch{return "#";}}
function ms(x){const v=Date.parse(x);return Number.isFinite(v)?v:NaN;}
function format(x,f=clockFmt){const t=ms(x);return Number.isFinite(t)?f.format(new Date(t)):"时间待核实";}
function recent(a){const t=ms(a?.published_at),age=Date.now()-t;return Number.isFinite(t)&&age>=0&&age<=SEVEN;}
function news(){return state.raw.filter(recent).sort((a,b)=>ms(b.published_at)-ms(a.published_at));}
function ed(a){return state.editorial[a.id]||{};}
function title(a){const e=ed(a);return typeof e.title_zh==="string"&&e.title_zh.trim()?e.title_zh:ZH[a.id]||a.title||"标题待核实";}
function summary(a){return ed(a).dek||"这条原始资讯已收录，尚未完成独立的中文事件解读。";}
function kind(a){return String(a.topic||"外汇市场");}
function codeFor(a){
 const joined=(a.title||"")+" "+kind(a);
 if(/美联储|federal reserve|fomc|美国|美元|usd|dollar/i.test(joined))return "USD";
 if(/欧洲|欧元|ecb|euro|eur/i.test(joined))return "EUR";
 if(/日本|日元|boj|jpy|yen/i.test(joined))return "JPY";
 if(/英镑|英国|gbp|sterling/i.test(joined))return "GBP";
 if(/人民币|中国|cny|cnh/i.test(joined))return "CNY";
 if(/港币|港元|香港|hkd/i.test(joined))return "HKD";
 return "FX";
}
function categoryType(a){
 const words=(a.title||"")+" "+kind(a);
 if(/央行|美联储|利率|FOMC|monetary policy|central bank/i.test(words))return "policy";
 if(/通胀|CPI|GDP|失业|就业|经济|就业|employment|inflation|payroll|yield|国债/i.test(words))return "macro";
 return "currency";
}
function matches(a){
 const cat=categoryType(a);
 const q=state.query.trim().toLocaleLowerCase("zh-CN");
 const e=ed(a);
 const hay=[a.title,title(a),a.source,a.topic,(a.pairs||[]).join(" "),e.dek,e.insight,e.business].join(" ").toLocaleLowerCase("zh-CN");
 return (state.filter==="all"||state.filter===cat)&&(!q||hay.includes(q));
}
function sourceMarket(pair){
 const m=state.market.find(x=>x?.pair===pair&&x.source&&x.date&&Number.isFinite(Number(x.value))&&Number(x.value)>0);
 if(!m)return null;
 const observed=ms(m.date+"T00:00:00Z"),diff=Date.now()-observed;
 return Number.isFinite(observed)&&diff>=-24*3600000&&diff<=9*24*3600000?m:null;
}
function price(m){if(!m)return "—";const n=Number(m.value);return n.toFixed(m.pair==="USD/JPY"?3:4);}
function pct(m){
 if(!m||m.change_5_published_days_pct===null||m.change_5_published_days_pct===undefined)return null;
 const n=Number(m.change_5_published_days_pct);return Number.isFinite(n)?n:null;
}
function deltaText(d){return d===null?"—":(d>0?"+":"")+d.toFixed(2)+"%";}
function deltaClass(d){return d===null?"flat":d>0?"up":d<0?"down":"flat";}
function validPoints(m){
 if(!m||!Array.isArray(m.points))return [];
 return m.points.filter(p=>p&&Number.isFinite(Number(p.value))&&Number(p.value)>0&&Number.isFinite(ms(p.date+"T00:00:00Z")));
}
function pathFor(points,width,height,pad){
 if(points.length<2)return "";
 const values=points.map(p=>Number(p.value)),lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;
 return points.map((p,i)=>{
   const x=pad+(i/(points.length-1))*(width-2*pad);
   const y=pad+(1-(Number(p.value)-lo)/span)*(height-2*pad);
   return (i===0?"M":"L")+x.toFixed(2)+" "+y.toFixed(2);
 }).join(" ");
}
function spark(m){
 const points=validPoints(m).slice(-15);
 if(points.length<2)return '<span class="quote-empty">—</span>';
 const d=pathFor(points,110,26,2),isDown=Number(points.at(-1).value)<Number(points[0].value);
 return '<svg class="quote-spark" viewBox="0 0 110 26" preserveAspectRatio="none" aria-hidden="true"><path d="'+d+'" fill="none" stroke="'+(isDown?"#bf5154":"#12855f")+'" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}
function renderMarket(){
 const pairs=["USD/CNY","EUR/USD","USD/JPY","GBP/USD","USD/HKD","EUR/GBP"];
 $("market-grid").innerHTML=pairs.map(pair=>{
   const m=sourceMarket(pair),d=pct(m);
   const hint=m?esc(m.source+" · "+m.date+"（日度参考）"):"尚无有效官方日度数据";
   return '<div class="quote-row" title="'+hint+'"><span class="quote-pair">'+esc(pair)+'</span>'+
     '<span class="quote-value">'+price(m)+'</span><span class="quote-change '+deltaClass(d)+'">'+deltaText(d)+'</span>'+
     spark(m)+'</div>';
 }).join("");
 const valid=state.market.filter(x=>sourceMarket(x.pair)).length;
 $("market-updated").textContent=valid+"组有日期的参考价 · 非实时行情";
 const latest=state.market.map(x=>x?.date).filter(Boolean).sort().at(-1);
 const delayed=state.marketSources.filter(x=>x.ok&&!x.date_fresh).map(x=>x.name+"（"+x.last_observation_date+"）");
 $("market-warning").textContent="汇率数据为官方工作日参考值或同日交叉计算，非银行可成交价；"+
 (latest?"最新观察日 "+latest+"。":"目前没有有效报价。")+
 (delayed.length?"部分来源滞后："+delayed.join("、")+"。":"");
}
function marketPairFor(a){
 const p=Array.isArray(a.pairs)?a.pairs:[];
 for(const k of ["USD/CNY","USD/JPY","EUR/USD","USD/HKD","GBP/USD"]){if(p.includes(k))return k;}
 const t=title(a);
 if(/人民币|CNY|CNH/i.test(t))return "USD/CNY";
 if(/日元|JPY/i.test(t))return "USD/JPY";
 if(/欧元|EUR/i.test(t))return "EUR/USD";
 if(/港币|港元|HKD/i.test(t))return "USD/HKD";
 if(/英镑|GBP/i.test(t))return "GBP/USD";
 return null;
}
function marketContext(a){
 const pair=marketPairFor(a),m=pair&&sourceMarket(pair);
 if(!m)return "";
 const d=pct(m),extra=d===null?"":' · 近5个公布日 '+deltaText(d);
 return '<div class="story-market"><span>'+esc(pair)+'</span><strong>'+price(m)+'</strong>'+
 '<span>'+esc(m.date)+extra+' · 官方参考值，非新闻发生时的成交价</span>'+
 '<a href="'+esc(safeURL(m.source_url))+'" target="_blank" rel="noopener noreferrer">'+esc(m.source)+' ↗</a></div>';
}
function highlightScore(a){
 const ageDays=(Date.now()-ms(a.published_at))/86400000;
 const name=title(a)+" "+kind(a);
 return (ed(a).insight?8:0)+(ed(a).status==="primary_checked"?3:0)
 +(/美元|人民币|美联储|日元|汇率|央行|USD|JPY|CNY|CNH|Fed|BOJ|ECB/i.test(name)?6:0)
 +(/美联储|联储|FOMC/i.test(name)?3:0)+Math.max(0,7-ageDays)*1.5;
}
function heroArticle(list){
 if(!list.length)return null;
 return [...list].sort((a,b)=>highlightScore(b)-highlightScore(a))[0];
}
function renderHero(list){
 const a=heroArticle(list);
 const hb=document.querySelector(".hero-background");
 if(!a){
  $("hero-title").textContent="最近七天暂时没有可核实的外汇新闻";
  $("hero-dek").textContent="当前不会使用过期资讯或示意新闻补位，请检查信源与采集状态。";
  $("hero-source").textContent="暂无资讯";$("hero-time").textContent="";
  $("hero-link").hidden=true;hb.classList.add("no-photo");$("photo-credit").hidden=true;return;
 }
 $("hero-category").textContent="焦点资讯 / "+kind(a);
 $("hero-title").textContent=title(a);
 $("hero-dek").textContent=summary(a);
 $("hero-source").textContent=a.source||"来源待核实";
 $("hero-time").textContent=format(a.published_at);
 $("hero-link").href="#story-"+a.id;
 $("hero-link").hidden=false;
 const federal=/美联储|联储|Federal Reserve|FOMC/i.test(a.title+" "+title(a));
 hb.classList.toggle("no-photo",!federal||state.imageFailed);
 $("photo-credit").hidden=!federal||state.imageFailed;
}
function shortStory(a){
 const cat=categoryType(a);
 return '<article class="news-entry"><div class="news-illustration type-'+cat+'" aria-hidden="true"><span>'+esc(codeFor(a))+'</span></div><div class="news-copy">'+
 '<a href="#story-'+esc(a.id)+'">'+esc(title(a))+'</a>'+
 '<div class="news-meta">'+esc(a.source||"来源待核实")+'　｜　'+esc(format(a.published_at))+'</div></div></article>';
}
function renderShortNews(list){
 $("short-news").innerHTML=list.length?list.slice(0,4).map(shortStory).join(""):'<p class="pending-text">当前无最近七天的资讯。</p>';
}
function previewStory(a){
 const e=ed(a);
 return '<article class="analysis-card"><div class="analysis-art" aria-hidden="true"><span>'+esc(codeFor(a))+'</span></div>'+
 '<div class="analysis-copy"><span class="analysis-topic">'+esc(kind(a))+'</span><a href="#story-'+esc(a.id)+'">'+esc(title(a))+'</a>'+
 '<p>'+esc(e.insight||e.dek||"解读仍在核验，详情请参阅原文。")+'</p>'+
 '<div class="analysis-meta">'+esc(a.source)+" · "+esc(format(a.published_at))+'</div></div></article>';
}
function renderAnalysis(list){
 const candidates=list.filter(a=>ed(a).insight).sort((a,b)=>highlightScore(b)-highlightScore(a));
 $("analysis-preview").innerHTML=candidates.length?candidates.slice(0,2).map(previewStory).join(""):'<p class="pending-text">暂无已完成的分析内容，待核验后上线。</p>';
}
function watchHTML(a){
 return '<a class="watch-story" href="#story-'+esc(a.id)+'"><strong>'+esc(title(a))+'</strong>'+
 '<small>'+esc(a.source||"新闻来源待核实")+' · '+esc(format(a.published_at))+'</small></a>';
}
function renderWatch(list){
 const picks=[];const chosenGroups=new Set();
 for(const a of [...list].sort((a,b)=>highlightScore(b)-highlightScore(a))){
   const group=codeFor(a);
   if(chosenGroups.has(group))continue;
   picks.push(a);chosenGroups.add(group);if(picks.length>=4)break;
 }
 for(const a of list){if(picks.length>=4)break;if(!picks.includes(a))picks.push(a);}
 $("watch-list").innerHTML=picks.length?picks.map(watchHTML).join(""):'<p class="pending-text">暂无近期可核实的重要事件。</p>';
 const ok=state.newsSources.filter(x=>x.ok).length;
 $("source-health").textContent="RSS信源 "+ok+"/"+state.newsSources.length+" 成功 · 数据状态以最近采集为准";
 $("week-range").textContent="最近7×24小时";
}
function renderFocus(list){
 const total=list.length;
 for(const cat of ["policy","macro","currency"]){
  const n=list.filter(a=>categoryType(a)===cat).length;
  $("focus-"+cat).textContent="近七天 "+n+" 条相关资讯";
 }
 $("focus-total").textContent="近七天 "+total+" 条资讯";
}
function renderChart(){
 const pair=state.selectedPair,m=sourceMarket(pair),points=validPoints(m).slice(-30);
 $("chart-title").textContent=pair+" / 走势";
 $("chart-value").textContent=price(m);
 const d=pct(m);$("chart-change").textContent=deltaText(d);$("chart-change").className=deltaClass(d);
 const container=$("detail-chart");
 if(points.length<2){container.innerHTML='<p class="pending-text">暂无满足日期和来源要求的历史报价。</p>'; $("chart-note").textContent="未取得可用历史数据，未补造曲线。";return;}
 const w=340,h=124,p=12,dPath=pathFor(points,w,h,p);
 const values=points.map(x=>Number(x.value)),min=Math.min(...values),max=Math.max(...values);
 const fillPath=dPath+" L"+(w-p)+" "+(h-p)+" L"+p+" "+(h-p)+" Z";
 const start=points[0].date.slice(5),end=points.at(-1).date.slice(5);
 container.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(pair)+'官方日度参考汇率从'+esc(start)+'至'+esc(end)+'的走势">'+
 '<path d="M'+p+' 35 H'+(w-p)+' M'+p+' 76 H'+(w-p)+'" fill="none" stroke="#e3eaf1" stroke-width="1"/>'+
 '<path d="'+fillPath+'" fill="#d6e8e3" opacity=".58"/>'+
 '<path d="'+dPath+'" fill="none" stroke="#15815d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'+
 '<text x="'+p+'" y="'+(h-1)+'" fill="#718397" font-size="10">'+esc(start)+'</text>'+
 '<text x="'+(w-p)+'" y="'+(h-1)+'" fill="#718397" font-size="10" text-anchor="end">'+esc(end)+'</text>'+
 '<text x="'+(w-p)+'" y="17" text-anchor="end" fill="#718397" font-size="10">'+esc(max.toFixed(pair==="USD/JPY"?2:4))+'</text></svg>';
 $("chart-note").textContent=m.date+" · "+m.source+" · "+points.length+"个官方公布日 · 非实时交易价";
}
function filterUI(){
 document.querySelectorAll("[data-filter]").forEach(b=>{
  const active=b.dataset.filter===state.filter;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));
 });
}
function validAI(){
 const b=state.brief;
 if(!b||b.reviewed!==true||b.schema_version!==1||b.method!=="chatgpt_review_with_cited_sources"||!Array.isArray(b.claims))return [];
 const delta=Date.now()-ms(b.generated_at);if(!Number.isFinite(delta)||delta<0||delta>26*3600000)return [];
 const ids=new Set(news().map(x=>x.id));
 return b.claims.filter(c=>c&&["F","O","I","X","U"].includes(c.type)&&["P0","P1","P2","P3","C","U"].includes(c.grade)
  &&typeof c.statement==="string"&&Array.isArray(c.evidence_ids)&&c.evidence_ids.length&&c.evidence_ids.every(id=>ids.has(id)));
}
function storyHTML(a,lastDay,claims){
 const e=ed(a),day=format(a.published_at,dayFmt);
 const dateHeader=lastDay!==day?'<div class="story-date">'+esc(day)+'　/　北京时间</div>':"";
 const isChecked=e.status==="primary_checked";
 const claimHTML=claims.filter(c=>c.evidence_ids.includes(a.id)).slice(0,2).map(c=>'<p>'+esc(c.statement)+' <span>('+esc(c.grade)+')</span></p>').join("");
 const note=claimHTML?'<div class="story-ai"><h4>已核验的研究补充 · '+esc(format(state.brief.generated_at))+'</h4>'+claimHTML+'</div>':"";
 const analysis=(e.insight||e.business)?'<div class="story-context">'+
 '<section><h4>市场解读</h4><p>'+esc(e.insight||"尚缺独立核验的解读。")+'</p></section>'+
 '<section><h4>相关商业影响</h4><p>'+esc(e.business||"尚未取得足够资料确认具体的商业影响。")+'</p></section></div>':"";
 const evidence=Array.isArray(e.evidence)?e.evidence.map(url=>'<p><a href="'+esc(safeURL(url))+'" target="_blank" rel="noopener noreferrer">官方原始材料 ↗</a></p>').join(""):"";
 const detail='<div class="story-details" id="detail-'+esc(a.id)+'" hidden><p><strong>下一步关注：</strong>'+esc(e.watch||"查看事件原始资料与后续更新。")+'</p><p><strong>证据边界：</strong>'+
 (isChecked?"已核对对应官方公开资料，尚不意味着事件与价格变化之间的因果关系已获证明。":"仅基于收录标题提供背景或已完成部分说明；原文事实尚未逐项核对。")+
 '</p>'+evidence+'</div>';
 return dateHeader+'<article class="story" id="story-'+esc(a.id)+'"><div class="story-time"><span>'+esc(format(a.published_at,timeFmt))+'</span><small>GMT +8</small></div>'+
 '<div class="story-main"><div class="story-meta"><span class="story-category">'+esc(kind(a))+'</span><span>'+esc(a.source||"来源待核实")+'</span></div>'+
 '<h3>'+esc(title(a))+'</h3><p class="story-dek">'+esc(summary(a))+'</p>'+marketContext(a)+analysis+note+
 '<div class="story-actions"><span>'+(isChecked?"官方原文已核对":"背景解读 · 未全部复核")+'</span>'+
 '<button type="button" data-detail="'+esc(a.id)+'" aria-controls="detail-'+esc(a.id)+'" aria-expanded="false">核验范围与后续关注 ▾</button>'+
 '<a href="'+esc(safeURL(a.url))+'" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a></div>'+detail+'</div></article>';
}
function renderStream(list){
 const all=list.filter(matches);
 $("article-count").textContent="近七天 "+list.length+" 条 · 当前 "+all.length+" 条";
 let lastDay="",markup="";
 const claims=validAI();
 for(const a of all.slice(0,state.limit)){
  const day=format(a.published_at,dayFmt);
  markup+=storyHTML(a,lastDay,claims);lastDay=day;
 }
 $("stream").innerHTML=markup||'<div class="empty-state">最近七天暂无符合条件的资讯；系统不会使用过期新闻或示例数据补位。</div>';
 $("load-more").hidden=all.length<=state.limit;
 $("load-more").textContent="显示更多（剩余 "+Math.max(0,all.length-state.limit)+" 条） ↓";
}
function renderStatus(){
 const n=ms(state.newsUpdated),age=Date.now()-n;
 $("latest-update").textContent=Number.isFinite(n)?"RSS最近成功采集："+format(state.newsUpdated)+"（北京时间）":"RSS 尚无成功采集记录";
 const dot=document.querySelector(".live-dot");
 const fresh=Number.isFinite(age)&&age>=0&&age<=80*60*1000;
 dot.classList.toggle("good",fresh);dot.classList.toggle("bad",!fresh);
 $("beijing-clock").textContent="北京 "+new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date());
}
function render(){
 const list=news();
 renderStatus();renderHero(list);renderMarket();renderFocus(list);renderShortNews(list);
 renderAnalysis(list);renderWatch(list);renderChart();renderStream(list);filterUI();
}
function setFilter(value){
 state.filter=["all","policy","macro","currency"].includes(value)?value:"all";
 state.limit=12;render();
 document.getElementById("latest-news").scrollIntoView({behavior:"smooth",block:"start"});
}
function goToStory(id){
 const index=news().findIndex(x=>x.id===id);
 if(index<0)return;
 state.filter="all";state.query="";$("search").value="";
 state.limit=Math.max(state.limit,index+1);
 render();
 document.getElementById("story-"+id)?.scrollIntoView({behavior:"smooth",block:"start"});
}
async function getJSON(path){
 const res=await fetch(path+"?r="+Date.now(),{cache:"no-store"});
 if(!res.ok)throw new Error(path+" HTTP "+res.status);
 return await res.json();
}
async function refresh(){
 if(state.busy)return;
 state.busy=true;
 try{
  const settled=await Promise.allSettled([
    getJSON("./data/articles.json"),getJSON("./data/editorial.json"),
    getJSON("./data/market.json"),getJSON("./data/ai-brief.json")
  ]);
  if(settled[0].status==="fulfilled"){
   const obj=settled[0].value;
   if(!Array.isArray(obj.articles))throw new Error("RSS 结构不可用");
   state.raw=obj.articles.filter(x=>x&&x.id&&x.title&&x.url&&x.published_at);
   state.newsSources=Array.isArray(obj.sources)?obj.sources:[];
   state.newsUpdated=obj.updated_at||null;
   state.loadError=null;
  }else{state.loadError=String(settled[0].reason?.message||"资讯快照无法读取");}
  if(settled[1].status==="fulfilled"){
   const d=settled[1].value;
   state.editorial=d?.items&&typeof d.items==="object"?d.items:{};
  }
  if(settled[2].status==="fulfilled"){
   const d=settled[2].value;
   state.market=Array.isArray(d?.instruments)?d.instruments:[];
   state.marketSources=Array.isArray(d?.sources)?d.sources:[];
   state.marketUpdated=d?.last_successful_at||null;
  }
  if(settled[3].status==="fulfilled")state.brief=settled[3].value;
  render();
  if(state.loadError)$("stream").insertAdjacentHTML("afterbegin",'<div class="empty-state">最新采集快照读取失败：'+esc(state.loadError)+'。显示仍符合七日时效的已缓存内容。</div>');
 }catch(e){
  state.loadError=String(e?.message||"数据校验失败");
  render();
  $("stream").insertAdjacentHTML("afterbegin",'<div class="empty-state">资讯数据结构校验失败：'+esc(state.loadError)+'</div>');
 }finally{state.busy=false;}
}
$("refresh-data").addEventListener("click",refresh);
$("header-search").addEventListener("click",()=>{
 document.getElementById("latest-news").scrollIntoView({behavior:"smooth"});
 $("search").focus({preventScroll:true});
});
$("search").addEventListener("input",e=>{state.query=e.target.value;state.limit=12;renderStream(news());});
$("clear-filter").addEventListener("click",()=>{
 state.query="";$("search").value="";state.filter="all";state.limit=12;renderStream(news());filterUI();
});
$("chart-select").addEventListener("change",e=>{
 state.selectedPair=e.target.value;renderChart();
});
$("load-more").addEventListener("click",()=>{state.limit+=12;renderStream(news());});
document.addEventListener("click",e=>{
 const filter=e.target.closest("[data-filter]");if(filter){setFilter(filter.dataset.filter);return;}
 const quick=e.target.closest("[data-quick-filter]");if(quick){setFilter(quick.dataset.quickFilter);return;}
 const detail=e.target.closest("[data-detail]");
 if(detail){
  const content=document.getElementById("detail-"+detail.dataset.detail);
  if(content){content.hidden=!content.hidden;detail.textContent=content.hidden?"核验范围与后续关注 ▾":"收起核验说明 ▴";detail.setAttribute("aria-expanded",String(!content.hidden));}
  return;
 }
 const storyLink=e.target.closest('a[href^="#story-"]');
 if(storyLink){
  const id=storyLink.getAttribute("href").slice(7);
  if(news().some(a=>a.id===id)){
   e.preventDefault();goToStory(id);
  }
 }
});
const photo=$("hero-photo");
photo.addEventListener("error",()=>{state.imageFailed=true;document.querySelector(".hero-background").classList.add("no-photo");$("photo-credit").hidden=true;});
refresh();
setInterval(()=>{if(!document.hidden)refresh();},3*60*1000);
setInterval(()=>{renderStatus();},60*1000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
