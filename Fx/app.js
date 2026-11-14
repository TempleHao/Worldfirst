/* FX 内参 — single-source-of-truth information flow. Real RSS + dated official FX reference values. */
"use strict";
const $=id=>document.getElementById(id);
const WINDOW=7*24*60*60*1000;
// R14 is the 14-pair viewing list, NOT a claim of 14 live providers:
// 13 ECB/HKMA official daily rates + independent USD/CNH third-party daily reference.
 // Third-party data are fetched directly by each visitor; never redistributed in our static JSON.
const R14=["USD/CNH","USD/CNY","USD/HKD","EUR/USD","USD/JPY","GBP/USD","AUD/USD","NZD/USD","USD/CAD","USD/CHF","USD/SGD","EUR/GBP","EUR/JPY","EUR/CHF"];
const FX_DATA_AGE_DAYS=9;
const CNH_FREE_URL="https://open.er-api.com/v6/latest/USD";
const CNH_FREE_DOCS="https://www.exchangerate-api.com/docs/free";
const CNH_COMMUNITY_URL="https://latest.currency-api.pages.dev/v1/currencies/usd.min.json";
const CNH_COMMUNITY_DOCS="https://github.com/fawazahmed0/exchange-api";
const state={
 articles:[],editorial:{},ai:null,sources:[],market:[],marketSources:[],
 newsUpdated:null,marketUpdated:null,filter:"all",search:"",limit:12,
 selectedPair:"EUR/USD",fetching:false,lastError:null,dataOrigins:{},remoteErrors:{},
 newsAttempted:null,marketAttempted:null,integrityIssues:[],invalidNews:0,newsAddedCount:null,newsOriginalLatest:null,
 cnh:null,cnhStatus:"pending",cnhError:null,cnhBusy:false,cnhAttemptedAt:0,cnhProvider:""
};
const zhTitles={
 "b2851de93965f784":"欧洲央行施纳贝尔发表《欧洲制造》主题讲话",
 "87a784bdd6110f05":"美联储修订2027年FOMC会议暂定日程",
 "0040329e474488dc":"美联储鲍曼谈美国经济与货币政策的考量",
 "e3471b85e9068b8b":"欧洲央行莱恩谈货币政策沟通的科学与实践",
 "461728c10cfa467f":"欧洲央行奇波洛内谈现金与数字欧元",
 "7e8ebfec1b135b15":"美联储沃勒谈经济展望与劳动力市场",
 "b9dcd2ec49851590":"欧洲央行拉加德接受《读卖新闻》采访"
};
const clockFmt=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
const dayFmt=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
const hourFmt=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hour12:false});
function esc(value){return String(value??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));}
function safeURL(value){try{const u=new URL(String(value));return /^https?:$/.test(u.protocol)?u.href:"#";}catch{return "#";}}
function ms(value){const n=Date.parse(value);return Number.isFinite(n)?n:NaN;}
function fmt(value,formatter=clockFmt){const n=ms(value);return Number.isFinite(n)?formatter.format(new Date(n)):"时间待核实";}
function sevenDays(a){const n=ms(a?.published_at),age=Date.now()-n;return Number.isFinite(n)&&age>=0&&age<=WINDOW;}
function allNews(){return state.articles.filter(sevenDays).sort((a,b)=>ms(b.published_at)-ms(a.published_at));}
function editorial(a){return state.editorial[a.id]||{};}
function headline(a){const e=editorial(a);return typeof e.title_zh==="string"&&e.title_zh.trim()?e.title_zh:zhTitles[a.id]||a.title||"标题待核实";}
function classOf(a){
 const t=((a.title||"")+" "+(a.topic||"")).toLowerCase();
 if(/央行|联储|货币政策|利率|fomc|monetary policy|central bank|interest rate|rate decision|fed\b/.test(t))return "policy";
 if(/通胀|cpi|pce|gdp|就业|失业|经济|债券|国债|yield|inflation|employment|payroll|recession/.test(t))return "macro";
 return "currency";
}
function matching(a){
 if(state.filter!=="all"&&classOf(a)!==state.filter)return false;
 if(!state.search.trim())return true;
 const e=editorial(a),q=state.search.trim().toLocaleLowerCase("zh-CN");
 return [a.title,headline(a),a.source,a.topic,(a.pairs||[]).join(" "),e.dek,e.insight,e.business].join(" ").toLocaleLowerCase("zh-CN").includes(q);
}
// Fail closed on malformed, mismatched, stale or falsely-labelled source records.
const RSS_DOMAINS={
 "美联储·货币政策":"www.federalreserve.gov","美联储·讲话":"www.federalreserve.gov",
 "欧洲央行·官方发布":"www.ecb.europa.eu",
 "英为财情·外汇新闻":"cn.investing.com","英为财情·外汇分析":"cn.investing.com",
 "日本央行·官方发布":"www.boj.or.jp","国际清算银行·央行讲话":"www.bis.org"
};
function urlHost(uri){try{const u=new URL(String(uri));return u.protocol==="https:"?u.hostname.toLowerCase():null;}catch{return null;}}
function strictDay(day){
 if(typeof day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
 const t=Date.parse(day+"T00:00:00Z");
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===day;
}
function validRSSArticle(a){
 if(!a||typeof a.id!=="string"||!/^[a-f0-9]{16}$/.test(a.id)
   ||typeof a.title!=="string"||!a.title.trim()||a.title.length>280
   ||!a.published_at||!Number.isFinite(ms(a.published_at)))return false;
 const required=RSS_DOMAINS[a.source];
 // The Bank of Japan still publishes several verified official RSS article links
 // with http://; permit only this exact official hostname in that legacy case.
 const articleHost=urlHost(a.url);
 let legacyBoJ=false;
 if(a.source==="日本央行·官方发布"&&typeof a.url==="string"){
  try{const u=new URL(a.url);legacyBoJ=u.protocol==="http:"&&u.hostname==="www.boj.or.jp";}catch{}
 }
 return !!required&&urlHost(a.source_url)===required&&(articleHost===required||legacyBoJ)
  &&["official","single_source"].includes(a.verification);
}
function validOfficialRate(m){
 if(!m||m.pair==="USD/CNH"||!R14.includes(m.pair)||!strictDay(m.date)
   ||typeof m.value!=="number"||!Number.isFinite(m.value)||m.value<=0||m.value>1000000)return false;
 const cross=m.method==="same_day_cross";
 const direct=["direct_eur_reference","direct_hkd_close"].includes(m.method);
 if(!cross&&!direct)return false;
 if(m.kind!==(cross?"official_daily_reference_cross":"official_daily_reference"))return false;
 if(m.source==="欧洲央行 ECB"){
  if(urlHost(m.source_url)!=="www.ecb.europa.eu"||m.method==="direct_hkd_close")return false;
 }else if(m.source==="香港金管局 HKMA"){
  if(urlHost(m.source_url)!=="apidocs.hkma.gov.hk"||m.method!=="direct_hkd_close"||m.pair!=="USD/HKD")return false;
 }else return false;
 if(!Array.isArray(m.points)||!m.points.length||m.points.length>120)return false;
 let lastDate="",lastValue=0;
 for(const p of m.points){
  if(!p||!strictDay(p.date)||p.date<=lastDate||typeof p.value!=="number"
   ||!Number.isFinite(p.value)||p.value<=0||p.value>1000000)return false;
  lastDate=p.date;lastValue=p.value;
 }
 if(lastDate!==m.date||Math.abs(lastValue-m.value)>0.000002)return false;
 if(m.change_5_published_days_pct!=null){
  if(typeof m.change_5_published_days_pct!=="number"||!Number.isFinite(m.change_5_published_days_pct)
    ||!strictDay(m.comparison_date))return false;
  const compare=m.points.find(p=>p.date===m.comparison_date);
  if(!compare||compare.date>=m.date)return false;
  const computed=(m.value/compare.value-1)*100;
  if(Math.abs(computed-m.change_5_published_days_pct)>0.02)return false;
 }
 return true;
}
function rateFor(pair){
 const m=pair==="USD/CNH"?state.cnh:state.market.find(x=>x?.pair===pair&&validOfficialRate(x));
 if(!m)return null;
 const day=ms(m.date+"T00:00:00Z"),age=Date.now()-day;
 return Number.isFinite(day)&&age>=-24*3600000&&age<=FX_DATA_AGE_DAYS*24*3600000?m:null;
}
// Validate the third-party CNH rate using its own quote code and provider observation timestamp.
// There is intentionally no CNY-based fallback or synthetic CNH calculation.
function parseCNHOpen(data,now=Date.now()){
 if(!data||data.result!=="success"||data.base_code!=="USD"||!data.rates||typeof data.rates!=="object")
  throw new Error("第三方返回结构或基准币种无效");
 const n=Number(data.rates.CNH),seconds=Number(data.time_last_update_unix);
 if(!Number.isFinite(n)||n<=0||n>100||!Number.isFinite(seconds)||seconds<=0)
  throw new Error("没有有效且带时间的离岸人民币报价");
 const observed=seconds*1000,age=now-observed;
 if(age< -4*3600000||age>5*86400000)throw new Error("第三方离岸报价日期过期或位于未来");
 const date=new Date(observed).toISOString().slice(0,10);
 return {pair:"USD/CNH",value:n,date,observation_timestamp:new Date(observed).toISOString(),
  source:"ExchangeRate-API",source_url:CNH_FREE_DOCS,method:"direct_third_party_daily_reference",
  kind:"third_party_daily_indicative",points:[{date,value:n}],
  change_5_published_days_pct:null,comparison_date:null};
}
function parseCNHCommunity(data,now=Date.now()){
 const raw=data?.usd?.cnh;
 if(!data||typeof data.date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(data.date))
  throw new Error("社区日度来源没有可用日期");
 const stamp=Date.parse(data.date+"T00:00:00Z"),age=now-stamp,n=Number(raw);
 if(!Number.isFinite(stamp)||age< -36*3600000||age>5*86400000
     ||!Number.isFinite(n)||n<=0||n>100)
  throw new Error("社区日度来源没有有效CNH数值或日期");
 return {pair:"USD/CNH",value:n,date:data.date,observation_timestamp:data.date+"T00:00:00Z",
  source:"Community Currency API",source_url:CNH_COMMUNITY_DOCS,
  method:"third_party_community_daily_reference",kind:"third_party_daily_indicative",
  points:[{date:data.date,value:n}],change_5_published_days_pct:null,comparison_date:null};
}
async function loadRemoteCNH(url){
 const response=await fetch(url,{mode:"cors",credentials:"omit",cache:"no-store",
   signal:typeof AbortSignal.timeout==="function"?AbortSignal.timeout(9000):undefined});
 if(!response.ok)throw new Error("数据提供方HTTP "+response.status);
 return response.json();
}
async function refreshCNH(){
 const now=Date.now();
 // Open access provider refreshes once per day; never poll it every three minutes.
 if(state.cnhBusy||now-state.cnhAttemptedAt<60*60*1000)return;
 state.cnhBusy=true;state.cnhAttemptedAt=now;state.cnhStatus="loading";state.cnhError=null;
 try{
  let result,firstError;
  try{result=parseCNHOpen(await loadRemoteCNH(CNH_FREE_URL));}
  catch(err){firstError=String(err?.message||err);}
  if(!result){
   try{result=parseCNHCommunity(await loadRemoteCNH(CNH_COMMUNITY_URL));}
   catch(err){throw new Error("官方发布之外的两条独立CNH公开来源均无法访问："+firstError+"；备用："+String(err?.message||err));}
  }
  state.cnh=result;state.cnhStatus="ok";state.cnhProvider=result.source;state.cnhError=null;
 }catch(err){
  state.cnhStatus="error";state.cnhError=String(err?.message||err);
  if(!rateFor("USD/CNH"))state.cnh=null;
 }finally{
  state.cnhBusy=false;
  renderMarket();renderChart();renderSources();renderNews();
 }
}
function quote(m){return m?Number(m.value).toFixed(m.pair==="USD/JPY"?3:4):"—";}
function delta(m){
 if(!m||m.change_5_published_days_pct==null)return null;
 const d=Number(m.change_5_published_days_pct);return Number.isFinite(d)?d:null;
}
function deltaLabel(d){return d===null?"—":(d>0?"+":"")+d.toFixed(2)+"%";}
function deltaStyle(d){return d===null||d===0?"neutral":d>0?"positive":"negative";}
function series(m){
 return !m||!Array.isArray(m.points)?[]:m.points.filter(p=>p&&p.date&&Number.isFinite(ms(p.date+"T00:00:00Z"))&&Number.isFinite(Number(p.value))&&Number(p.value)>0).slice(-30);
}
function polyline(points,w,h,pad){
 if(points.length<2)return "";
 const values=points.map(p=>Number(p.value)),min=Math.min(...values),span=Math.max(...values)-min||1;
 return points.map((pt,i)=>{
  const x=pad+i/(points.length-1)*(w-2*pad);
  const y=pad+(1-(Number(pt.value)-min)/span)*(h-2*pad);
  return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);
 }).join(" ");
}
function sparkline(m){
 const list=series(m).slice(-12);
 if(list.length<2)return "";
 const line=polyline(list,72,24,2);
 return '<svg class="tile-spark" viewBox="0 0 72 24" preserveAspectRatio="none" aria-hidden="true"><path d="'+line+'" fill="none" stroke="'+
 (Number(list.at(-1).value)<Number(list[0].value)?"#f47a81":"#36c996")+'" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}
function marketTile(pair,duplicate=false){
 const m=rateFor(pair),d=delta(m),isCNH=pair==="USD/CNH",isCNY=pair==="USD/CNY";
 const waiting=isCNH&&!m&&["pending","loading"].includes(state.cnhStatus);
 const sourceLabel=isCNH?(m?"离岸 · "+m.date.slice(5).replace("-","/"):waiting?"离岸 · 获取中":"离岸 · 暂无数据"):
   isCNY?(m?"在岸 · "+m.date.slice(5).replace("-","/"):"在岸 · 暂无数据"):
   m?m.date.slice(5).replace("-","/"):"暂无数据";
 const hint=m?m.source+" · "+m.date+" · "+(isCNH?"第三方日度参考，非官方基准":"官方日度参考/交叉计算")+" · 非可成交价":
  isCNH?(waiting?"正在查询CNH第三方日度参考":"CNH独立数据源不可用，绝不使用在岸CNY代替"):"暂无有效日期的官方日度参考数据";
 const amount=m?quote(m):waiting?"获取中":"暂无数据";
 const changeLabel=d===null?'':'<span class="tile-change-label">5D</span>';
 return '<button type="button" class="market-tile'+(state.selectedPair===pair?" active":"")+
   (!m?" unquoted":"")+(isCNH?" offshore-rate":"")+'" data-pair="'+pair+'"'+(duplicate?' tabindex="-1"':'')+
   ' aria-label="'+esc(pair)+" · "+esc(hint)+
   '" title="'+esc(hint)+'"><span class="tile-code">'+esc(pair)+'</span>'+
   '<span class="tile-amount'+(!m?" missing":"")+'">'+esc(amount)+'</span>'+
   '<span class="tile-bottom"><span class="tile-delta '+deltaStyle(d)+'">'+changeLabel+deltaLabel(d)+'</span>'+sparkline(m)+'</span>'+
   '<small class="tile-origin">'+esc(sourceLabel)+'</small></button>';
}
function renderMarket(){
 const viewport=$("market-viewport");
 const savedScroll=viewport.scrollLeft;
 const items=R14.map(p=>marketTile(p,false)).join("");
 const copy=R14.map(p=>marketTile(p,true)).join("");
 $("market-grid").innerHTML='<div class="ticker-run" role="group" aria-label="14个外汇观察货币对">'+items+'</div>'+
 '<div class="ticker-run ticker-clone" aria-hidden="true">'+copy+'</div>';
 const first=$("market-grid").firstElementChild?.offsetWidth||0;
 if(first)viewport.scrollLeft=savedScroll%first;

}
function renderChart(){
 const m=rateFor(state.selectedPair),points=series(m),d=delta(m);
 $("chart-select").value=state.selectedPair;
 $("chart-value").textContent=quote(m);
 $("chart-change").textContent=deltaLabel(d);
 $("chart-change").className=deltaStyle(d);
 const target=$("detail-chart");
 if(points.length<2){
  target.innerHTML='<p class="loading">暂无可核实的历史走势，未填入模拟曲线。</p>';
  if(state.selectedPair==="USD/CNH"&&m){
   target.innerHTML='<div class="chart-single-note">已取得独立离岸人民币日度参考值 · '+esc(m.date)+
    '<br>当前提供方只发布这一期参考值，尚无可核实的连续历史序列，未绘制虚假曲线。</div>';
   $("chart-note").textContent=m.source+" · "+m.date+" · 第三方日度参考，非官方定盘价或可成交价";
  }else{
   $("chart-note").textContent=state.selectedPair==="USD/CNH"?
    "CNH第三方来源暂无法读取，请检查来源状态；绝不使用境内CNY代替。":
    m?m.source+" · "+m.date+" · 官方参考价（非实时）":"官方参考记录尚不可用";
  }
  return;
 }
 const w=340,h=158,pad=12,line=polyline(points,w,h,pad);
 const bottom=h-pad,area=line+" L"+(w-pad)+" "+bottom+" L"+pad+" "+bottom+" Z";
 const vals=points.map(p=>Number(p.value)),max=Math.max(...vals),min=Math.min(...vals);
 target.innerHTML='<svg viewBox="0 0 340 158" role="img" aria-label="'+esc(state.selectedPair)+'官方公布日历史走势">'+
 '<path d="M12 44 H328 M12 86 H328 M12 128 H328" fill="none" stroke="#2e4050" stroke-width=".8"/>'+
 '<path d="'+area+'" fill="#204d50" opacity=".35"/>'+
 '<path d="'+line+'" fill="none" stroke="#64c9c2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
 '<text x="12" y="156" font-size="9" fill="#98acc0">'+esc(points[0].date.slice(5))+'</text>'+
 '<text x="328" y="156" font-size="9" fill="#98acc0" text-anchor="end">'+esc(points.at(-1).date.slice(5))+'</text>'+
 '<text x="328" y="13" font-size="9" fill="#98acc0" text-anchor="end">'+max.toFixed(m.pair==="USD/JPY"?2:4)+'</text>'+
 '<text x="328" y="145" font-size="9" fill="#98acc0" text-anchor="end">'+min.toFixed(m.pair==="USD/JPY"?2:4)+'</text></svg>';
 $("chart-note").textContent=m.source+" · "+m.date+" · "+points.length+"个公布日 · "+(m.method==="same_day_cross"?"同日交叉计算":"直接参考数据")+" · 非实时可成交价";
}
function renderSources(){
 const rss=state.sources.map(s=>({
  name:s.name,ok:!!s.ok,status:s.ok?"已获取":"失败",label:s.ok?"抓取"+(Number.isFinite(Number(s.count))?s.count+"条":"成功")+(s.latest_item_published_at?" · 源最近"+fmt(s.latest_item_published_at):" · 源未提供有效发布时间"):"抓取失败"
 }));
 const market=state.marketSources.map(s=>({
  name:s.name,ok:!!s.ok&&s.date_fresh!==false,
  status:s.ok?(s.date_fresh===false?"滞后":"已获取"):"失败",
  label:s.ok?(s.date_fresh===false?"数据滞后 "+(s.last_observation_date||""):(s.last_observation_date||"已获取")):"抓取失败"
 }));
 const cnh=rateFor("USD/CNH");
 const cnSource={name:"USD/CNH · 离岸日度参考",
    ok:!!cnh,status:cnh?"已取得":"获取失败",
    label:cnh?cnh.source+" · "+cnh.date:state.cnhStatus==="loading"?"查询中":state.cnhStatus==="error"?"第三方源不可用":"待加载"};
 const sources=[...rss,...market,cnSource];
 $("source-list").innerHTML=sources.length?sources.map(s=>'<div class="source-row"><span>'+esc(s.name)+'</span><small class="'+(!s.ok?"bad":"")+'">'+esc(s.label)+'</small></div>').join(""):'<p class="loading">尚未取得信源健康记录。</p>';
 const old=state.marketSources.filter(s=>s.ok&&s.date_fresh===false).map(s=>s.name+" "+(s.last_observation_date||"未知日期"));
 $("market-warning").textContent="13组来源为官方日度参考或同日交叉；USD/CNH独立第三方日度参考。全部不是实时或银行成交报价。"+
 (state.integrityIssues.length?"本次有"+state.integrityIssues.length+"组报价未通过日期、来源或历史数值一致性校验，已隐藏。":"")+
 (old.length?"以下来源本轮数据滞后："+old.join("、")+"；过期值不会覆盖新观察。":"原始日期与来源在数据详情中展示。");
}
function renderStatus(){
 const n=ms(state.newsUpdated),age=Date.now()-n;
 const recent=Number.isFinite(n)&&age>=0&&age<=70*60*1000;
 const source=state.dataOrigins.news==="repository"?"仓库最新数据":state.dataOrigins.news==="page"?"网站静态备份":"数据源未知";
 const delay=Number.isFinite(age)&&age>=0?(age<3600000?Math.floor(age/60000)+"分钟前":(age/3600000).toFixed(1)+"小时前"):"时间未核实";
 const attempt=ms(state.newsAttempted);
 $("latest-update").textContent=Number.isFinite(n)?"RSS "+source+" · 最近成功拉取 "+fmt(state.newsUpdated)+"（北京）· "+delay+(recent?"":" · 更新延迟")+(Number.isFinite(attempt)&&attempt>n+30000?" · 最近尝试 "+fmt(state.newsAttempted):""):"RSS 尚无有效成功拉取时间";
 const lamp=$("status-light");lamp.classList.toggle("good",recent);lamp.classList.toggle("bad",!recent);
 lamp.title=recent?"最近成功采集处于预期窗口内":"最近成功采集已超出预期窗口，可能存在调度、采集或发布故障";
 const healthy=state.sources.filter(x=>x.ok).length;
 $("source-health").textContent=state.sources.length?"上次拉取 "+healthy+"/"+state.sources.length+" 源成功（非事实核验）":"RSS 信源状态未取得";
 $("beijing-clock").textContent=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date())+" 北京";
}
function pairForArticle(a){
 const t=headline(a);
 if(/CNH|离岸人民币/i.test(t))return "USD/CNH";
 const tags=Array.isArray(a.pairs)?a.pairs:[];
 for(const pair of R14){if(tags.includes(pair))return pair;}
 if(/CNY|在岸人民币|境内人民币/i.test(t))return "USD/CNY";
 if(/日元|JPY/.test(t))return "USD/JPY";
 if(/欧元|EUR/.test(t))return "EUR/USD";
 if(/港币|港元|HKD/.test(t))return "USD/HKD";
 if(/英镑|GBP/.test(t))return "GBP/USD";
 return null;
}
function articleRate(a){
 const pair=pairForArticle(a),r=pair&&rateFor(pair);
 if(!r)return "";
 return '<div class="item-quote"><span class="pair">'+esc(pair)+'</span><span class="rate">'+quote(r)+'</span><span>'+(r.kind==="third_party_daily_indicative"?"第三方日度":"官方")+' '+esc(r.date)+' 参考，非新闻发生时的成交价</span><a href="'+esc(safeURL(r.source_url))+'" target="_blank" rel="noopener noreferrer">数据来源 ↗</a><button type="button" data-chart-pair="'+esc(pair)+'" class="quote-chart-link">查看走势 ↗</button></div>';
}
function currentClaims(){
 const b=state.ai,n=ms(b?.generated_at),age=Date.now()-n;
 if(!b||b.schema_version!==1||b.reviewed!==true||b.method!=="chatgpt_review_with_cited_sources"||!Array.isArray(b.claims)||!Number.isFinite(n)||age<0||age>26*3600000)return [];
 const ids=new Set(allNews().map(a=>a.id));
 return b.claims.filter(c=>c&&typeof c.statement==="string"&&Array.isArray(c.evidence_ids)&&c.evidence_ids.length>0&&c.evidence_ids.every(id=>ids.has(id)));
}
function entryHTML(a,lastDay,claims,position){
 const e=editorial(a),day=fmt(a.published_at,dayFmt);
 const evidenceURLs=typeof e.evidence==="string"?[e.evidence]:Array.isArray(e.evidence)?e.evidence:[];
 const isOfficial=e.status==="primary_checked"&&evidenceURLs.some(url=>urlHost(url)!==null);
 const dateHead=day!==lastDay?'<div class="news-date">'+esc(day)+' <span>BEIJING TIME</span></div>':"";
 const dek=e.dek?'<p class="item-dek">'+esc(e.dek)+'</p>':"";
 const analysis=e.insight||e.business?'<div class="item-analysis">'+(e.insight?'<p>'+esc(e.insight)+'</p>':"")+(e.business?'<p>'+esc(e.business)+'</p>':"")+'</div>':"";
 const supplement=claims.filter(c=>c.evidence_ids.includes(a.id)).slice(0,3);
 const note=supplement.length?'<div class="claims"><strong>已关联来源的研究补充（结论仍需复核）</strong>'+supplement.map(c=>'<p>'+esc(c.statement)+'</p>').join("")+'</div>':"";
 const evidenceList=typeof e.evidence==="string"?[e.evidence]:Array.isArray(e.evidence)?e.evidence:[];
 const refs=evidenceList.filter(Boolean).map(url=>'<p><a href="'+esc(safeURL(url))+'" target="_blank" rel="noopener noreferrer">官方材料与原文 ↗</a></p>').join("");
 const detail='<div class="proof-brief" id="proof-'+esc(a.id)+'" hidden><p><strong>需要继续关注：</strong>'+esc(e.watch||"该新闻的官方后续信息与原始资料。")+'</p>'+
 '<p><strong>核验范围：</strong>'+(isOfficial?"编辑记录提供了可查看的官方资料链接；请以原始文本为准，不能直接推断价格变化因果。":"目前未完成全部原文核验。部分文字属于基于标题的经济背景解读。")+'</p>'+refs+'</div>';
 return dateHead+'<article class="news-item" id="story-'+esc(a.id)+'" data-article-id="'+esc(a.id)+'">'+
 '<div class="item-time">'+esc(fmt(a.published_at,hourFmt))+'<small>GMT +8</small></div>'+
 '<div class="item-main"><div class="item-byline"><span class="item-topic">'+esc(a.topic||"外汇市场")+'</span><span>'+esc(a.source||"来源待核实")+'</span></div>'+
 '<h2 class="item-headline">'+esc(headline(a))+'</h2>'+dek+analysis+articleRate(a)+note+
 '<div class="item-foot"><span class="proof'+(isOfficial?" checked":"")+'">'+(isOfficial?"标记为已核对官方原文":e.dek||e.insight?"背景解读 · 有待补充核验":"原始资讯 · 尚无独立解读")+'</span>'+
 '<button type="button" data-proof="'+esc(a.id)+'" aria-controls="proof-'+esc(a.id)+'" aria-expanded="false">证据与后续关注 ▾</button>'+
 '<a href="'+esc(safeURL(a.url))+'" target="_blank" rel="noopener noreferrer">原文 ↗</a></div>'+detail+'</div></article>';
}
function renderNews(){
 const records=allNews(),filtered=records.filter(matching),claims=currentClaims();
 $("article-count").textContent="近七日 "+records.length+" 条";
 const published=records[0]?.published_at||state.newsOriginalLatest;
 const publishedAge=Date.now()-ms(published);
 const sourceQuiet=Number.isFinite(publishedAge)&&publishedAge>=12*3600000?" · 距最近源文章已"+Math.floor(publishedAge/3600000)+"小时":"";
 const runNew=Number.isInteger(state.newsAddedCount)?" · 本轮新收录"+state.newsAddedCount+"条":"";
 $("feed-status").textContent="当前筛选 "+filtered.length+" 条 · 最新在前 · 北京时间"+
 (published?" · 最新原文发布 "+fmt(published)+sourceQuiet:" · 暂无含时间的最新文章")+
 runNew+
 (state.invalidNews?" · "+state.invalidNews+"条元数据未通过来源校验，未展示":"")+
 (state.lastError?" · 最近一次请求异常":"");
 let previous=null;
 $("stream").innerHTML=filtered.length?filtered.slice(0,state.limit).map((a,i)=>{
  const html=entryHTML(a,previous,claims,i);previous=fmt(a.published_at,dayFmt);return html;
 }).join(""):'<div class="empty-state">最近七天暂无符合筛选条件的资讯，未使用旧新闻或示例内容补位。</div>';
 $("load-more").hidden=filtered.length<=state.limit;
 $("load-more").textContent="继续阅读（剩余 "+Math.max(0,filtered.length-state.limit)+" 条） ↓";
 document.querySelectorAll("[data-filter]").forEach(btn=>{
  const active=btn.dataset.filter===state.filter;
  btn.classList.toggle("active",active);btn.setAttribute("aria-pressed",String(active));
 });
}
function render(){renderMarket();renderChart();renderSources();renderStatus();renderNews();}
async function json(file){
 if(!/^(articles|editorial|market|ai-brief)\.json$/.test(file))throw new Error("Unsupported data name");
 const remote="https://raw.githubusercontent.com/TempleHao/Worldfirst/main/Fx/data/"+file;
 let remoteError=null;
 try{
  const r=await fetch(remote+"?v="+Date.now(),{cache:"no-store",signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw new Error("GitHub raw HTTP "+r.status);
  return {value:await r.json(),origin:"repository"};
 }catch(err){remoteError=String(err?.message||err);}
 const path="./data/"+file;
 const fallback=await fetch(path+"?v="+Date.now(),{cache:"no-store"});
 if(!fallback.ok)throw new Error("GitHub与网页备份均无法读取 "+file+"（"+remoteError+"）");
 return {value:await fallback.json(),origin:"page",remoteError};
}
async function refresh(){
 if(state.fetching)return;
 state.fetching=true;
 try{
  const results=await Promise.allSettled([
   json("articles.json"),json("editorial.json"),
   json("market.json"),json("ai-brief.json")
  ]);
  const news=results[0];
  if(news.status==="fulfilled"&&Array.isArray(news.value?.value?.articles)){
   state.dataOrigins.news=news.value.origin;
   state.remoteErrors.news=news.value.remoteError||null;
   const snapshot=news.value.value;
   state.articles=snapshot.articles.filter(validRSSArticle);
   state.invalidNews=snapshot.articles.length-state.articles.length;
   state.newsAttempted=snapshot.attempted_at||null;
   state.newsAddedCount=Number.isInteger(snapshot.new_article_count)?snapshot.new_article_count:null;
   state.newsOriginalLatest=snapshot.latest_article_published_at||null;
   state.sources=Array.isArray(snapshot.sources)?snapshot.sources:[];
   state.newsUpdated=snapshot.updated_at||null;
   state.lastError=null;
  }else{state.lastError=String(news.status==="rejected"?news.reason?.message:"RSS 数据结构异常");}
  if(results[1].status==="fulfilled")state.editorial=results[1].value?.value?.items||{};
  if(results[2].status==="fulfilled"){
   const snapshot=results[2].value.value;
   const raw=Array.isArray(snapshot?.instruments)?snapshot.instruments:[];
   state.integrityIssues=raw.filter(m=>!validOfficialRate(m)).map(m=>m?.pair||"未知货币对");
   state.market=raw.filter(validOfficialRate);
   state.marketAttempted=snapshot?.attempted_at||null;
   state.marketSources=Array.isArray(snapshot?.sources)?snapshot.sources:[];
   state.marketUpdated=snapshot?.last_successful_at||null;
  }
  if(results[3].status==="fulfilled")state.ai=results[3].value.value;
  render();
  if(state.lastError)$("stream").insertAdjacentHTML("afterbegin",'<div class="empty-state">最新资讯读取失败：'+esc(state.lastError)+'，仅保留仍处于最近七天的已缓存内容。</div>');
 }finally{state.fetching=false;}
}
function selectPair(pair,scroll){
 if(!R14.includes(pair))return;
 state.selectedPair=pair;renderMarket();renderChart();
 if(scroll)document.getElementById("market-chart").scrollIntoView({behavior:"smooth",block:"start"});
}
$("chart-select").addEventListener("change",e=>selectPair(e.target.value,false));
$("search").addEventListener("input",e=>{state.search=e.target.value;state.limit=12;renderNews();});
$("header-search").addEventListener("click",()=>{
 $("search").focus();document.getElementById("latest-news").scrollIntoView({behavior:"smooth",block:"start"});
});
$("refresh-data").addEventListener("click",refresh);
$("load-more").addEventListener("click",()=>{state.limit+=12;renderNews();});
document.addEventListener("click",event=>{
 const market=event.target.closest("[data-pair]");
 if(market){selectPair(market.dataset.pair,false);return;}
 const linked=event.target.closest("[data-chart-pair]");
 if(linked){selectPair(linked.dataset.chartPair,true);return;}
 const filter=event.target.closest("[data-filter]");
 if(filter){state.filter=filter.dataset.filter||"all";state.limit=12;renderNews();return;}
 const proof=event.target.closest("[data-proof]");
 if(proof){
  const target=document.getElementById("proof-"+proof.dataset.proof);
  if(target){target.hidden=!target.hidden;proof.textContent=target.hidden?"证据与后续关注 ▾":"收起核验说明 ▴";proof.setAttribute("aria-expanded",String(!target.hidden));}
 }
});
const tickerState={pauseUser:false,hover:false,focus:false,holdUntil:0,previousFrame:0,lastFrame:null};
function initTicker(){
 const viewport=$("market-viewport"),toggle=$("ticker-toggle"),reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
 const setUserPause=(paused)=>{
  tickerState.pauseUser=paused;
  toggle.setAttribute("aria-pressed",String(paused));
  toggle.textContent=paused?"继续滚动 ▷":"暂停滚动 Ⅱ";
 };
 setUserPause(reduced.matches);
 toggle.addEventListener("click",()=>setUserPause(!tickerState.pauseUser));
 viewport.addEventListener("mouseenter",()=>{tickerState.hover=true;});
 viewport.addEventListener("mouseleave",()=>{tickerState.hover=false;});
 viewport.addEventListener("focusin",()=>{tickerState.focus=true;});
 viewport.addEventListener("focusout",e=>{if(!viewport.contains(e.relatedTarget))tickerState.focus=false;});
 viewport.addEventListener("pointerdown",()=>{tickerState.holdUntil=Date.now()+12000;});
 viewport.addEventListener("wheel",()=>{tickerState.holdUntil=Date.now()+12000;},{passive:true});
 for(const [id,sign] of [["ticker-prev",-1],["ticker-next",1]]){
  $(id).addEventListener("click",()=>{
   tickerState.holdUntil=Date.now()+12000;
   viewport.scrollBy({left:sign*440,behavior:reduced.matches?"instant":"smooth"});
  });
 }
 function frame(t){
  const elapsed=tickerState.previousFrame?Math.min(64,t-tickerState.previousFrame):0;
  tickerState.previousFrame=t;
  const group=$("market-grid").firstElementChild;
  const cycle=group?.offsetWidth||0;
  if(cycle&&viewport.scrollLeft>=cycle)viewport.scrollLeft-=cycle;
  const paused=tickerState.pauseUser||tickerState.hover||tickerState.focus||document.hidden||reduced.matches||Date.now()<tickerState.holdUntil;
  if(!paused&&cycle&&elapsed>0){
   viewport.scrollLeft+=(elapsed*0.038);
   if(viewport.scrollLeft>=cycle)viewport.scrollLeft-=cycle;
  }
  requestAnimationFrame(frame);
 }
 requestAnimationFrame(frame);
}
initTicker();
refresh();
void refreshCNH();
setInterval(()=>{if(!document.hidden)refresh();},3*60*1000);
setInterval(renderStatus,60*1000);
setInterval(()=>{if(!document.hidden)void refreshCNH();},60*60*1000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden){refresh();void refreshCNH();}});
