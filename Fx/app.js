/* FX 内参 / 商务外汇资讯流 · 真实数据与来源优先。 */
"use strict";
const $=id=>document.getElementById(id);
const WEEK=7*24*60*60*1000;
const state={raw:[],visible:[],editorial:{},brief:null,sources:[],updated_at:null,market:[],marketSources:[],marketLastSuccess:null,marketAttempted:null,filter:"all",query:"",limit:12,loading:true,fetchInFlight:false};
const zhTitles={
"b2851de93965f784":"欧洲央行施纳贝尔发表《欧洲制造》主题讲话",
"87a784bdd6110f05":"美联储修订2027年FOMC会议暂定日程",
"0040329e474488dc":"美联储鲍曼：美国经济与货币政策的考量",
"e3471b85e9068b8b":"欧洲央行莱恩：货币政策沟通的科学与实践",
"461728c10cfa467f":"欧洲央行奇波洛内：现金与数字欧元的关系",
"7e8ebfec1b135b15":"美联储沃勒：美国经济展望与劳动力市场动态",
"b9dcd2ec49851590":"欧洲央行拉加德接受《读卖新闻》采访"
};
const fmtDay=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit"});
const fmtDate=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
const fmtTime=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hour12:false});
const fmtStamp=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
function esc(t){return String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function safeLink(url){try{const u=new URL(String(url));return /^(https?:)$/.test(u.protocol)?u.href:"#";}catch{return "#";}}
function ms(v){const n=Date.parse(v);return Number.isFinite(n)?n:NaN;}
function recent(article){const t=ms(article.published_at);const diff=Date.now()-t;return Number.isFinite(t)&&diff>=0&&diff<=WEEK;}
function stamp(value,fmt=fmtStamp){let n=ms(value);return Number.isFinite(n)?fmt.format(new Date(n)):"时间未核实";}
function title(a){const e=state.editorial[a.id]||{};return typeof e.title_zh==="string"&&e.title_zh.trim()?e.title_zh:zhTitles[a.id]||a.title||"标题待补充";}
function topic(a){return a.topic||"外汇资讯";}
function canShowAI(c,id){
 return c&&["F","O","I","X","U"].includes(c.type)&&["P0","P1","P2","P3","C","U"].includes(c.grade)&&typeof c.statement==="string"&&Array.isArray(c.evidence_ids)&&c.evidence_ids.includes(id)&&c.evidence_ids.every(e=>state.raw.some(a=>a.id===e&&recent(a)));
}
function currentAI(){
 const b=state.brief;
 if(!b||b.schema_version!==1||b.reviewed!==true||b.method!=="chatgpt_review_with_cited_sources"||!Array.isArray(b.claims))return [];
 const t=ms(b.generated_at),elapsed=Date.now()-t;if(!Number.isFinite(t)||elapsed<0||elapsed>26*3600000)return [];
 const valid=b.claims.every(c=>["F","O","I","X","U"].includes(c.type)&&["P0","P1","P2","P3","C","U"].includes(c.grade)&&typeof c.statement==="string"&&Array.isArray(c.evidence_ids)&&c.evidence_ids.length>0&&c.evidence_ids.every(e=>state.raw.some(a=>a.id===e&&recent(a))));
 return valid?b.claims:[];
}

const SHOW_PAIRS=["EUR/USD","USD/CNY","USD/JPY","USD/HKD","GBP/USD","EUR/GBP"];
const sourceMarket=pair=>state.market.find(x=>x.pair===pair&&x.source&&x.date&&Number.isFinite(Number(x.value))&&Number(x.value)>0);
function referenceOld(row){
 const d=Date.parse(row?.date||"");return !Number.isFinite(d)||Date.now()-d>8*24*3600000;
}
function displayQuote(row){
 if(!row||referenceOld(row))return "—";
 const n=Number(row.value);
 return n.toFixed(row.pair==="USD/JPY"?3:4);
}
function safeSparkline(points){
 if(!Array.isArray(points)||points.length<2)return "";
 const list=points.slice(-15).map(p=>Number(p.value)).filter(n=>Number.isFinite(n)&&n>0);
 if(list.length<2)return "";
 const min=Math.min(...list),max=Math.max(...list),delta=max-min||1;
 const coords=list.map((n,i)=>[Math.round(100*i/(list.length-1)),Math.round(23-18*(n-min)/delta)]).map(x=>x.join(",")).join(" ");
 return '<svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="#137e74" stroke-width="1.5" vector-effect="non-scaling-stroke" points="'+coords+'"/></svg>';
}
function pairRelated(a){
 const joined=[a.title,title(a),(Array.isArray(a.pairs)?a.pairs:[]).join(" ")].join(" ");
 const pairs=Array.isArray(a.pairs)?a.pairs:[];
 for(const p of ["USD/CNY","USD/HKD","USD/JPY","EUR/USD","GBP/USD"]){
   if(pairs.includes(p))return p;
 }
 if(/人民币|CNY|CNH/.test(joined))return "USD/CNY";
 if(/港币|港元|HKD/.test(joined))return "USD/HKD";
 if(/日元|JPY/.test(joined))return "USD/JPY";
 if(/欧元|EUR/.test(joined))return "EUR/USD";
 if(/英镑|GBP/.test(joined))return "GBP/USD";
 return null;
}
function contextFor(a){
 const pair=pairRelated(a),rate=pair&&sourceMarket(pair);
 if(!rate||referenceOld(rate))return "";
 const change=Number(rate.change_5_published_days_pct);
 const movement=Number.isFinite(change)&&rate.change_5_published_days_pct!==null?" · 近5个公布日 "+(change>0?"+":"")+change.toFixed(2)+"%":"";
 return '<div class="news-reference"><span class="nr-pair">'+esc(pair)+'</span><strong>'+esc(displayQuote(rate))+'</strong>'+
 '<span class="nr-note">'+esc(rate.date)+' 官方参考'+esc(movement)+' · <a href="'+esc(safeLink(rate.source_url))+'" target="_blank" rel="noopener noreferrer">'+esc(rate.source)+'</a> · 并非该新闻发生时的报价</span></div>';
}
function marketHTML(pair){
 const row=sourceMarket(pair),ok=row&&!referenceOld(row);
 const change=ok&&row.change_5_published_days_pct!==null?Number(row.change_5_published_days_pct):NaN;
 const changeText=Number.isFinite(change)?((change>0?"+":"")+change.toFixed(2)+"%"):"—";
 const move=Number.isFinite(change)?(change>0?"up":change<0?"down":"flat"):"flat";
 const label=ok?esc(row.date)+" · "+esc(row.source):row?"历史参考已过期":"暂无真实数据";
 const link=ok?'<a href="'+esc(safeLink(row.source_url))+'" target="_blank" rel="noopener noreferrer">原始数据 ↗</a>':"";
 return '<div class="market-quote"><span class="pair">'+esc(pair)+'</span><div class="rate-line"><strong>'+esc(displayQuote(row))+'</strong><span class="change '+move+'">'+esc(changeText)+'</span></div>'+
 (ok?safeSparkline(row.points):"")+'<span class="quote-source">'+label+(link?" · "+link:"")+'</span></div>';
}
function renderMarket(){
 $("market-grid").innerHTML=SHOW_PAIRS.map(marketHTML).join("");
 const success=state.marketSources.filter(x=>x.ok).length;
 const fresh=state.marketSources.filter(x=>x.ok&&x.date_fresh===true).length;
 const latest=state.market.filter(r=>r.date).map(r=>r.date).sort().at(-1);
 $("market-updated").textContent=latest?"最新官方观察日期 "+latest+" · 有效来源 "+fresh+"/"+state.marketSources.length:"尚未取得官方有效报价";
 const delayed=state.marketSources.filter(x=>x.ok&&!x.date_fresh).map(x=>x.name+"观测日 "+(x.last_observation_date||"未知")).join("；");
 const sourceLine=state.marketSources.length&&success===0?"本轮官方接口均未成功，历史数据按原日期显示。":delayed?"以下来源数据滞后，未用于覆盖较新汇率："+delayed:"";
 $("market-warning").textContent="官方日度参考价及交叉计算 · 非实时买卖价 · 涨跌幅为近5个公布日"+(sourceLine?" · "+sourceLine:"");
}

function filterMatch(a){
 const q=state.query.toLocaleLowerCase("zh-CN").trim();
 const e=state.editorial[a.id]||{};
 const text=[a.title,title(a),a.source,a.topic,e.dek,e.insight,e.business,(a.pairs||[]).join(" ")].join(" ").toLocaleLowerCase("zh-CN");
 if(q&&!text.includes(q))return false;
 if(state.filter==="policy")return /货币政策|央行|利率|美联储|联储|fomc|美债|inflation|政策/i.test(text);
 if(state.filter==="currency")return /美元|人民币|日元|港币|英镑|欧元|智利比索|加元|外汇|汇率|forex|usd|eur|jpy|cny|peso|cad/i.test(a.title+" "+title(a));
 if(state.filter==="macro")return /通胀|GDP|经济|财政|就业|储备|债券|劳动力|工资|国债|inflation/i.test(a.title+" "+title(a));
 return true;
}
function highlightHTML(a,n){
 return '<div class="highlight"><span class="highlight-no">0'+n+'</span><div><a href="#story-'+esc(a.id)+'">'+esc(title(a))+'</a><small>'+esc(a.source)+' · '+esc(stamp(a.published_at,fmtDay))+'</small></div></div>';
}
function renderHighlights(items){
 const picks=["0590b115c87e920c","cc29a3d0dc50233e","7e8ebfec1b135b15"];
 const chosen=picks.map(id=>items.find(a=>a.id===id)).filter(Boolean);
 for(const a of items){if(chosen.length>=3)break;if(!chosen.includes(a))chosen.push(a);}
 $("highlight-links").innerHTML=chosen.length?chosen.map((a,i)=>highlightHTML(a,i+1)).join(""):'<p class="sidebar-empty">本周暂无可用内容。</p>';
}
function storyHTML(a,previousDay){
 const e=state.editorial[a.id]||{};
 const d=stamp(a.published_at,fmtDay);
 const dateHeader=d!==previousDay?'<div class="date-divider"><span>'+esc(stamp(a.published_at,fmtDate))+'</span><span>BEIJING TIME</span></div>':"";
 const ai=currentAI().filter(c=>canShowAI(c,a.id)).slice(0,3);
 const status=e.status==="primary_checked"?"官方原文已复核":"标题背景解读";
 const reference=e.status==="primary_checked"?"核验至官方公开讲话或公告；其他因果尚未验证":"依据已收录的 RSS 标题提供背景分析，尚未逐条核对报道全文";
 const dek=e.dek||"这条资讯已收录，但还没有足够证据生成专属解读。请通过原文链接查看发布内容。";
 const m=e.insight||"目前暂无通过证据校验的逐条市场解读。";
 const business=e.business||"尚未形成可靠的商务参考，不建议只根据标题调整收付汇计划。";
 const watch=e.watch||"需要进一步查看原文、发布时间、汇率数据及其他独立来源。";
 const aiHTML=ai.length?'<div class="ai-note"><h5>经核验的 AI 编辑补充 <span>· '+esc(stamp(state.brief.generated_at))+'</span></h5>'+ai.map(c=>'<p>'+esc(c.statement)+' <small>('+esc(c.grade)+')</small></p>').join("")+'</div>':"";
 const marketContext=contextFor(a);
 const details='<div class="story-details" id="detail-'+esc(a.id)+'" hidden><p><strong>继续关注：</strong>'+esc(watch)+'</p><p><strong>当前核验范围：</strong>'+esc(reference)+'</p>'+(Array.isArray(e.evidence)?e.evidence.map(u=>'<p><a class="source-cite" href="'+esc(safeLink(u))+'" target="_blank" rel="noopener noreferrer">官方材料 ↗</a></p>').join(""):"")+'</div>';
 return dateHeader+
 '<article class="story" id="story-'+esc(a.id)+'">'+
 '<div class="story-side"><strong>'+esc(stamp(a.published_at,fmtTime))+'</strong><small>GMT +8</small></div>'+
 '<div class="story-main"><div class="story-meta"><span class="channel">'+esc(topic(a))+'</span><span class="bullet"></span><span>'+esc(a.source)+'</span></div>'+
 '<h3>'+esc(title(a))+'</h3><p class="story-dek">'+esc(dek)+'</p>'+marketContext+
 '<div class="story-analysis"><section><h4>市场解读 / MARKET CONTEXT</h4><p>'+esc(m)+'</p></section><section><h4>商务参考 / BUSINESS IMPLICATION</h4><p>'+esc(business)+'</p></section></div>'+
 aiHTML+
 '<div class="story-footer"><span class="basis'+(e.status==="primary_checked"?' verified':'')+'">'+esc(status)+'</span><div class="story-actions"><button data-details="'+esc(a.id)+'" type="button" aria-controls="detail-'+esc(a.id)+'" aria-expanded="false">依据与后续关注 ▾</button><a href="'+esc(safeLink(a.url))+'" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a></div></div>'+
 details+'</div></article>';
}
function render(){
 renderMarket();
 const all=state.raw.filter(recent).sort((a,b)=>ms(b.published_at)-ms(a.published_at));
 const visible=all.filter(filterMatch);
 state.visible=visible;
 $("week-range").textContent=stamp(new Date(Date.now()-WEEK).toISOString(),fmtDate)+" — "+stamp(new Date().toISOString(),fmtDate)+" · 北京时间";
 $("article-count").textContent="近七天 "+all.length+" 条 · 当前筛选 "+visible.length+" 条";
 const last=ms(state.updated_at);
 $("latest-update").textContent=last?"最近采集："+stamp(state.updated_at)+"（北京时间）":"尚无成功采集时间";
 const ok=state.sources.filter(s=>s.ok).length;
 $("healthy-sources").textContent=state.sources.length?ok+"/"+state.sources.length:"未连接";
 $("source-detail").textContent=state.sources.length?"本轮 "+state.sources.length+" 个 RSS 信源，"+ok+" 个获取成功。采集成功仅表示取得公开订阅内容，新闻观点仍需分层核验。":"尚未取得信源状态。";
 const fresh=Number.isFinite(last)&&Date.now()-last>=0&&Date.now()-last<=3*3600000;
 $("status-dot").classList.toggle("ok",fresh);
 $("status-text").textContent=fresh?"最近采集有效":"数据可能延迟";
 const list=visible.slice(0,state.limit),frag=[];
 let lastDay=null;
 for(const a of list){const day=stamp(a.published_at,fmtDay);frag.push(storyHTML(a,lastDay));lastDay=day;}
 $("stream").innerHTML=frag.length?frag.join(""):'<div class="empty-state"><strong>最近七天暂无匹配资讯</strong>可以调整搜索词或选择其他分类。这里不会使用旧新闻或演示内容补位。</div>';
 const more=$("load-more");more.hidden=visible.length<=state.limit;more.textContent="继续阅读（剩余 "+Math.max(0,visible.length-state.limit)+" 条） ↓";
 renderHighlights(all);
}
async function fetchData(){
 if(state.fetchInFlight)return;
 state.fetchInFlight=true;
 try{
   const [newsRes,editRes,aiRes,marketRes]=await Promise.all([
     fetch("./data/articles.json?rev="+Date.now(),{cache:"no-store"}),
     fetch("./data/editorial.json?rev="+Date.now(),{cache:"no-store"}),
     fetch("./data/ai-brief.json?rev="+Date.now(),{cache:"no-store"}),
     fetch("./data/market.json?rev="+Date.now(),{cache:"no-store"})
   ]);
   if(!newsRes.ok)throw new Error("资讯接口 HTTP "+newsRes.status);
   const data=await newsRes.json();
   if(!data||!Array.isArray(data.articles))throw new Error("资讯数据格式错误");
   state.raw=data.articles.filter(x=>x&&typeof x==="object"&&x.id&&x.title&&x.url);
   state.sources=Array.isArray(data.sources)?data.sources:[];
   state.updated_at=data.updated_at;
   if(editRes.ok){const e=await editRes.json();state.editorial=e&&e.items&&typeof e.items==="object"?e.items:{};}
   if(aiRes.ok){state.brief=await aiRes.json();}
   if(marketRes.ok){
      const snapshot=await marketRes.json();
      state.market=Array.isArray(snapshot.instruments)?snapshot.instruments:[];
      state.marketSources=Array.isArray(snapshot.sources)?snapshot.sources:[];
      state.marketAttempted=snapshot.attempted_at;
      state.marketLastSuccess=snapshot.last_successful_at;
   }
   render();
 }catch(error){
   state.raw=[];state.sources=[];state.updated_at=null;render();
   $("stream").innerHTML='<div class="empty-state"><strong>暂时无法读取资讯</strong>'+esc(error.message)+'。请查看自动更新状态。</div>';
 } finally {
   state.fetchInFlight=false;
 }
}
document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>{
 state.filter=b.dataset.filter;state.limit=12;
 document.querySelectorAll("[data-filter]").forEach(x=>{const on=x===b;x.classList.toggle("active",on);x.setAttribute("aria-pressed",String(on));});
 render();
}));
$("search").addEventListener("input",e=>{state.query=e.target.value;state.limit=12;render();});
$("clear-filter").addEventListener("click",()=>{
 state.query="";state.filter="all";state.limit=12;$("search").value="";
 document.querySelectorAll("[data-filter]").forEach(x=>{const on=x.dataset.filter==="all";x.classList.toggle("active",on);x.setAttribute("aria-pressed",String(on));});
 render();
});
$("load-more").addEventListener("click",()=>{state.limit+=12;render();});
document.addEventListener("click",e=>{
 const shortcut=e.target.closest('.highlight a[href^="#story-"]');
 if(shortcut){
   e.preventDefault();
   const id=shortcut.getAttribute("href").slice("#story-".length);
   const all=state.raw.filter(recent).sort((a,b)=>ms(b.published_at)-ms(a.published_at));
   const index=all.findIndex(a=>a.id===id);
   if(index>=0){
     state.query="";state.filter="all";state.limit=Math.max(state.limit,index+1);
     $("search").value="";
     document.querySelectorAll("[data-filter]").forEach(x=>{const active=x.dataset.filter==="all";x.classList.toggle("active",active);x.setAttribute("aria-pressed",String(active));});
     render();
     document.getElementById("story-"+id)?.scrollIntoView({behavior:"smooth",block:"start"});
   }
   return;
 }
 const btn=e.target.closest("[data-details]");if(!btn)return;
 const detail=document.getElementById("detail-"+btn.dataset.details);if(!detail)return;
 detail.hidden=!detail.hidden;btn.setAttribute("aria-expanded",String(!detail.hidden));btn.textContent=detail.hidden?"依据与后续关注 ▾":"收起补充信息 ▴";
});
fetchData();
$("refresh-data").addEventListener("click",fetchData);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)fetchData();});
setInterval(()=>{if(!document.hidden)fetchData();},3*60*1000);
