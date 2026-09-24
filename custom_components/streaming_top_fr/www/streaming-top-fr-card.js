const STFR_VERSION = "1.0.9-stremio.2";
class StreamingTopFrCard extends HTMLElement {
  connectedCallback(){
    if(this._statusSyncHandler)return;
    this._statusSyncHandler=e=>{if(e?.detail?.source===this)return;void this._externalStatusRefresh()};
    window.addEventListener("streaming-top-fr-status-changed",this._statusSyncHandler);
  }
  disconnectedCallback(){
    if(this._statusSyncHandler)window.removeEventListener("streaming-top-fr-status-changed",this._statusSyncHandler);
    this._statusSyncHandler=null;
  }
  async _externalStatusRefresh(){if(this._hass&&!this._loading)await this._load()}
  _broadcastStatusChange(){window.dispatchEvent(new CustomEvent("streaming-top-fr-status-changed",{detail:{source:this}}))}
  setConfig(c){
    this._config={title:"Streaming",default_provider:"netflix",default_media:"movies",...c};
    if(!this.shadowRoot)this.attachShadow({mode:"open"});
    this._provider=this._config.default_provider;
    this._media=this._config.default_media;
    this._section="discover";
    this._data=null;this._loading=false;this._error=null;this._render();
  }
  set hass(h){this._hass=h;if(!this._data&&!this._loading)this._load()}
  getCardSize(){return 6}
  async _load(){if(!this._hass)return;this._loading=true;this._render();try{this._data=await this._hass.callWS({type:"streaming_top_fr/get_data"});const order=this._providerOrder();if(order.length&&!order.includes(this._provider))this._provider=order[0];this._error=null}catch(e){this._error=String(e)}finally{this._loading=false;this._render()}}
  async _refresh(){if(!this._hass)return;this._loading=true;this._render();try{await this._hass.callWS({type:"streaming_top_fr/refresh"});await this._load()}catch(e){this._error=String(e);this._loading=false;this._render()}}
  async _set(item,status,enabled){
    const work=this._work(item);
    await this._hass.callWS({type:"streaming_top_fr/set_status",key:work.media_key,status,enabled,item:work});
    await this._load();
    this._broadcastStatusChange();
  }
  _esc(s){return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
  _watched(){return new Set(this._data?.watched_keys||[])}
  _watchlist(){return new Set(this._data?.watchlist_keys||[])}
  _notInterested(){return new Set(this._data?.not_interested_keys||[])}
  _providerOrder(){const configured=this._data?.provider_order;if(Array.isArray(configured))return configured.filter(x=>this._data?.providers?.[x]);return Object.keys(this._data?.providers||{})}
  _pd(){return this._data?.providers?.[this._provider]||null}
  _selectedMediaType(){return this._media==="movies"?"movie":"tv"}
  _stored(bucket){
    const mt=this._selectedMediaType();
    return(this._data?.[bucket]||[]).map(x=>x.item||{}).filter(x=>x.media_type===mt);
  }
  _items(){
    if(this._section==="watched")return this._stored("watched");
    if(this._section==="watchlist")return this._stored("watchlist");
    if(this._section==="not_interested")return this._stored("not_interested");
    const w=this._watched(),n=this._notInterested();
    const all=(this._pd()?.[this._media]||[]).filter(x=>!w.has(x.media_key)&&!n.has(x.media_key));
    const configured=Number(this._data?.settings?.discovery?.visible_count ?? 10);
    const visible=Number.isFinite(configured)?Math.max(1,Math.floor(configured)):10;
    return all.slice(0,visible);
  }
  _label(id){return{netflix:"Netflix",disney:"Disney+",prime:"Prime Video",hbo_max:"HBO Max",apple_tv:"Apple TV+",paramount:"Paramount+",canal:"CANAL+",crunchyroll:"Crunchyroll",mubi:"MUBI",adn:"ADN"}[id]||this._data?.providers?.[id]?.name||id}
  _providerLogo(id){
    const logos={
      netflix:`<span class="brand-logo brand-netflix" aria-hidden="true"><span class="netflix-n">N</span></span>`,
      disney:`<span class="brand-logo brand-disney" aria-hidden="true"><span class="disney-arc"></span><span class="disney-word">Disney+</span></span>`,
      prime:`<span class="brand-logo brand-prime" aria-hidden="true"><span class="prime-word">prime</span><span class="prime-smile"></span></span>`,
      hbo_max:`<span class="brand-logo brand-word brand-hbomax" aria-hidden="true">HBO&nbsp;Max</span>`,
      apple_tv:`<span class="brand-logo brand-word brand-apple" aria-hidden="true">Apple&nbsp;TV+</span>`,
      paramount:`<span class="brand-logo brand-word brand-paramount" aria-hidden="true">Paramount+</span>`,
      canal:`<span class="brand-logo brand-word brand-canal" aria-hidden="true">CANAL+</span>`,
      crunchyroll:`<span class="brand-logo brand-word brand-crunchy" aria-hidden="true">Crunchyroll</span>`,
      mubi:`<span class="brand-logo brand-word brand-mubi" aria-hidden="true">MUBI</span>`,
      adn:`<span class="brand-logo brand-word brand-adn" aria-hidden="true">ADN</span>`
    };
    return logos[id]||`<span class="brand-logo brand-word">${this._esc(this._label(id))}</span>`;
  }
  _playLabel(id){return{netflix:"Voir sur Netflix",disney:"Voir sur Disney+",prime:"Lancer Prime",hbo_max:"Voir sur HBO Max",apple_tv:"Voir sur Apple TV+",paramount:"Voir sur Paramount+",canal:"Voir sur CANAL+",crunchyroll:"Voir sur Crunchyroll",mubi:"Voir sur MUBI",adn:"Voir sur ADN"}[id]||`Voir sur ${this._label(id)}`}
  _providerPayload(i){
    const provider=String(i?.provider||"").trim();
    if(!provider)return null;
    return{provider,provider_name:i.provider_name||this._label(provider),watch_url:i.watch_url||null,playback_id:i.playback_id||null,details_url:i.details_url||null};
  }
  _mergeWorks(...items){
    const out={};const providers={};let imdbPoster=null;
    for(const src of items){
      if(src?.poster_source==="imdb"&&src?.poster)imdbPoster=src.poster;
      if(!src||typeof src!=="object")continue;
      for(const [k,v] of Object.entries(src)){
        if(k==="providers")continue;
        if(v!==null&&v!==undefined&&v!==""&&!(Array.isArray(v)&&!v.length)&&!(typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).length===0))out[k]=v;
        else if(!(k in out))out[k]=v;
      }
      if(src.providers&&typeof src.providers==="object"){
        for(const [pid,pdata] of Object.entries(src.providers)){
          if(!pid)continue;providers[pid]={...(providers[pid]||{}),...(pdata&&typeof pdata==="object"?pdata:{}),provider:pid};
        }
      }
      const legacy=this._providerPayload(src);
      if(legacy)providers[legacy.provider]={...(providers[legacy.provider]||{}),...legacy};
    }
    out.providers=providers;if(imdbPoster){out.poster=imdbPoster;out.poster_source="imdb"}return out;
  }
  _work(i){
    if(!i?.media_key)return i||{};
    const variants=[];
    Object.values(this._data?.providers||{}).forEach(p=>{
      for(const x of [...(p.movies||[]),...(p.tv||[])])if(x.media_key===i.media_key)variants.push(x);
    });
    for(const b of ["watched","watchlist","not_interested"]){
      for(const row of (this._data?.[b]||[])){const x=row.item||{};if(x.media_key===i.media_key)variants.push(x)}
    }
    variants.push(i);
    return this._mergeWorks(...variants);
  }
  _find(k){
    const current=(this._currentItems||[]).find(x=>x.media_key===k);
    if(current)return current;
    const exact=(this._pd()?.[this._media]||[]).find(x=>x.media_key===k);
    if(exact)return exact;
    for(const b of ["watched","watchlist","not_interested"]){
      const row=(this._data?.[b]||[]).find(x=>x.item?.media_key===k);if(row)return row.item||{};
    }
    let found=null;Object.values(this._data?.providers||{}).some(p=>{found=[...(p.movies||[]),...(p.tv||[])].find(x=>x.media_key===k);return!!found});
    return found;
  }
  _variantForProvider(i,provider){
    const work=this._work(i);const p=work.providers?.[provider]||{};
    return{...work,...p,provider,provider_name:p.provider_name||this._label(provider)};
  }
  _availableProviders(i){
    const work=this._work(i);const enabled=this._providerOrder();const keys=new Set(Object.keys(work.providers||{}));
    if(work.provider)keys.add(work.provider);
    return enabled.filter(x=>keys.has(x));
  }
  _players(){
    const raw=this._data?.settings?.players||{};
    return Object.entries(raw).filter(([,v])=>v&&typeof v==="object").map(([id,v])=>({id,name:v.name||id,type:v.type||"android_tv",media_player:v.media_player||null,remote:v.remote||null,adb_player:v.adb_player||null}));
  }
  _playbackId(i){
    if(i.playback_id)return String(i.playback_id);
    const u=String(i.watch_url||"");
    if(i.provider==="netflix"){const m=u.match(/\/(?:title|watch)\/(\d+)(?:[/?#]|$)/i);return m?m[1]:""}
    if(i.provider==="disney"){const m=u.match(/entity-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);return m?m[1]:""}
    return "";
  }
  _supportsPlayback(provider){
    const ids=this._data?.playback_providers;return Array.isArray(ids)?ids.includes(provider):["netflix","disney","prime"].includes(provider);
  }
  _canPlay(i){return this._supportsPlayback(i.provider)&&(i.provider==="prime"||i.provider==="disney"||!!this._playbackId(i))}
  async _play(i,provider,playerId,button){
    if(!this._hass)return;
    const variant=this._variantForProvider(i,provider);
    const contentId=this._playbackId(variant);
    if(provider!=="prime"&&provider!=="disney"&&!contentId){if(button){button.innerHTML=`<span class="launching">ID indisponible</span>`;button.disabled=true}return}
    const old=button?.innerHTML;if(button){button.disabled=true;button.innerHTML=`<span class="launching">Lancement…</span>`}
    try{
      const msg={type:"streaming_top_fr/play",provider,player:playerId};
      if(contentId)msg.content_id=contentId;
      if(variant.watch_url)msg.watch_url=String(variant.watch_url);
      if(variant.title)msg.title=String(variant.title);
      if(variant.original_title)msg.original_title=String(variant.original_title);
      if(variant.year!==null&&variant.year!==undefined&&variant.year!=="")msg.year=variant.year;
      if(variant.media_type)msg.media_type=String(variant.media_type);
      await this._hass.callWS(msg);
      this.shadowRoot.querySelector('.modalbg')?.remove();
    }catch(e){if(button){button.disabled=false;button.innerHTML=old||"Réessayer"}this._error=`Lecture: ${String(e)}`}
  }
  _playSections(i){
    const providers=this._availableProviders(i);if(!providers.length)return"";
    const players=this._players();
    return providers.map(provider=>{
      const variant=this._variantForProvider(i,provider);const logo=this._providerLogo(provider);const label=this._playLabel(provider);
      if(!this._supportsPlayback(provider))return`<div class="service-play unavailable"><div class="service-heading"><span class="play-brand">${logo}</span><strong>${this._esc(label)}</strong></div><small>Lancement Home Assistant non encore validé</small></div>`;
      if(!players.length)return`<div class="service-play unavailable"><div class="service-heading"><span class="play-brand">${logo}</span><strong>${this._esc(label)}</strong></div><small>Aucune destination configurée</small></div>`;
      const playable=this._canPlay(variant);const title=playable?"Lancer sur cette destination":"ID de lecture indisponible pour ce titre";
      const buttons=players.map(pl=>`<button class="${this._esc(provider)}" data-play-provider="${this._esc(provider)}" data-player="${this._esc(pl.id)}" ${playable?"":"disabled"} title="${this._esc(title)}${pl.media_player?` · ${this._esc(pl.media_player)}`:""}"><span class="play-brand">${logo}</span><span class="playcopy"><strong>${this._esc(label)}</strong><small>${this._esc(pl.name)}</small></span></button>`).join("");
      return`<div class="service-play"><div class="playrow">${buttons}</div></div>`;
    }).join("");
  }
  _actionButtons(i){
    const w=this._watched().has(i.media_key),l=this._watchlist().has(i.media_key),n=this._notInterested().has(i.media_key);
    if(this._section==="not_interested"){
      return `<button data-act="restore" data-key="${this._esc(i.media_key)}" class="ico restore" title="Remettre dans À découvrir">↩</button><button data-act="watched" data-key="${this._esc(i.media_key)}" class="ico" title="Marquer déjà vu">✓</button>`;
    }
    return `<button data-act="watched" data-key="${this._esc(i.media_key)}" class="ico ${w?"on":""}" title="${w?"Marquer non vu":"Déjà vu"}">✓</button><button data-act="watchlist" data-key="${this._esc(i.media_key)}" class="ico ${l?"on":""}" title="${l?"Retirer de Ma liste":"Ajouter à Ma liste"}">${l?"♥":"♡"}</button><button data-act="not_interested" data-key="${this._esc(i.media_key)}" class="ico reject ${n?"on":""}" title="Pas intéressé">×</button>`;
  }
  _ageFor(i){
    const cfg=this._data?.settings?.classification||{};
    if(cfg.enabled===false)return {value:null,country:null};
    const fr=i.age_fr||(String(i.age_country||"").toUpperCase()==="FR"?i.age_certification:null);
    const us=i.age_us||(String(i.age_country||"").toUpperCase()==="US"?i.age_certification:null);
    if(fr){
      if(cfg.france!==false)return {value:fr,country:"FR"};
      return {value:null,country:null};
    }
    if(cfg.us_fallback!==false&&us){
      const v=String(us).toUpperCase();
      if(v.startsWith("TV-")&&cfg.us_tv===false)return {value:null,country:null};
      return {value:us,country:"US"};
    }
    return {value:null,country:null};
  }
  _ageBadge(value,country){
    const v=String(value||"").trim().toUpperCase();
    const c=String(country||"").trim().toUpperCase();
    if(!v)return "";
    if(c==="FR")return `<span class="age-badge fr" title="Classification France ${this._esc(v)}">${this._esc(v)}</span>`;
    if(c==="US")return `<span class="age-badge us" title="Classification US ${this._esc(v)}">${this._esc(v)}</span>`;
    return "";
  }
  _card(i){
    const rating=i.rating!=null?`★ ${Number(i.rating).toFixed(1)} ${i.rating_source||""}`:"";
    const meta=[i.year,rating,i.days_in_top?`${i.days_in_top}× Top`:""].filter(Boolean).join('<span class="sep">·</span>');
    const rank=(i.rank!==null&&i.rank!==undefined&&Number(i.rank)>0)?`<span class="rank">#${this._esc(i.rank)}</span>`:"";
    return `<article class="mcard" data-key="${this._esc(i.media_key)}"><div class="poster">${i.poster?`<img src="${this._esc(i.poster)}" loading="lazy">`:`<div class="fallback">${this._esc((i.title||"?")[0])}</div>`}${rank}<div class="actions">${this._actionButtons(i)}</div></div><div class="info"><b>${this._esc(i.title)}</b>${i.subtitle?`<small>${this._esc(i.subtitle)}</small>`:""}<em class="meta-line">${meta}</em></div></article>`;
  }
  _render(){
    if(!this.shadowRoot)return;
    const p=this._pd(),items=this._items();
    this._currentItems=items;
    const selectedMediaType=this._selectedMediaType();
    const filt=(bucket)=>(this._data?.[bucket]||[]).filter(x=>x.item?.media_type===selectedMediaType).length;
    const wc=filt("watched"),lc=filt("watchlist"),nc=filt("not_interested");
    let body;
    if(this._loading&&!this._data)body='<div class="state">Chargement…</div>';
    else if(this._error)body=`<div class="state err">${this._esc(this._error)}</div>`;
    else if(this._section==="discover"&&p?.error&&!(p?.[this._media]||[]).length)body=`<div class="state err"><b>Source indisponible</b><br>${this._esc(p.error)}</div>`;
    else if(items.length)body=`<div class="rail">${items.map(i=>this._card(i)).join("")}</div>`;
    else {
      const raw=(p?.[this._media]||[]).length;
      const hidden=wc+nc;
      body=`<div class="state">${this._section==="discover"&&raw>0&&hidden>0?"Tous les titres de ce classement sont déjà classés 🎉":this._section==="discover"?"Aucun titre dans cette rubrique.":"Aucun titre dans cette rubrique."}</div>`;
    }
    const upd=this._data?.updated_at?new Date(this._data.updated_at).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
    this.shadowRoot.innerHTML=`<style>:host{display:block}ha-card{overflow:hidden}.wrap{padding:18px}.top{display:flex;align-items:center;gap:12px}.title{font-size:1.2rem;font-weight:850}.updated,.source{color:var(--secondary-text-color);font-size:.72rem}.spacer{flex:1}.refresh{border:0;border-radius:50%;width:38px;height:38px;background:var(--secondary-background-color);color:var(--primary-text-color);font-size:18px;cursor:pointer}.tabs{display:flex;gap:8px;overflow:auto;margin-top:12px;scrollbar-width:none}.provider-tabs,.media-tabs{justify-content:center}.provider-tabs.many{justify-content:flex-start;overflow-x:auto}.tab{border:0;border-radius:999px;padding:9px 14px;font:inherit;font-weight:800;background:var(--secondary-background-color);color:var(--secondary-text-color);white-space:nowrap;cursor:pointer}.tab.active{background:var(--primary-color);color:#fff}.netflix.active{background:#e50914}.disney.active{background:#1535c9}.prime.active{background:#00a8e1;color:#07151c}.count{padding:2px 6px;border-radius:999px;background:rgba(127,127,127,.18);font-size:.68rem}.source{margin:12px 0}.rail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(155px,175px);gap:13px;overflow-x:auto;padding:2px 2px 12px}.mcard{overflow:hidden;border-radius:18px;background:var(--card-background-color);box-shadow:0 3px 12px rgba(0,0,0,.16);cursor:pointer}.poster{position:relative;aspect-ratio:2/3;background:#222}.poster img,.fallback{width:100%;height:100%;object-fit:cover}.fallback{display:grid;place-items:center;font-size:4rem;font-weight:900;background:linear-gradient(145deg,#343741,#14151a);color:#777}.rank{position:absolute;left:8px;top:8px;padding:5px 8px;border-radius:999px;background:rgba(0,0,0,.78);color:#fff;font-size:.7rem;font-weight:900}.actions{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:6px}.ico{border:0;width:35px;height:35px;border-radius:50%;background:rgba(0,0,0,.76);color:#fff;font-size:17px;cursor:pointer}.ico.on{background:var(--primary-color)}.ico.reject{font-size:23px}.ico.reject.on{background:#b3261e}.ico.restore{font-size:19px;background:#325d3a}.info{padding:10px 11px 12px;min-height:68px}.info b{display:block;line-height:1.2}.info small,.info em{display:block;color:var(--secondary-text-color);font-size:.7rem;margin-top:4px;font-style:normal}.meta-line{display:flex!important;align-items:center;gap:5px;white-space:nowrap;overflow:hidden}.meta-line .sep{opacity:.7}.age-badge{display:inline-grid;place-items:center;flex:0 0 auto;box-sizing:border-box;font-weight:900;line-height:1;vertical-align:middle}.age-badge.fr{width:29px;height:29px;border-radius:50%;background:#d9d9d9!important;color:#111!important;border:0!important;font-size:.66rem;box-shadow:none!important}.age-badge.us{min-width:42px;height:26px;padding:0 7px;border-radius:6px;background:#242424!important;color:#fff!important;border:0!important;font-size:.64rem;letter-spacing:.01em;box-shadow:none!important}.state{padding:34px 8px;text-align:center;color:var(--secondary-text-color);line-height:1.5}.err{color:var(--error-color,#d93025)}.provider-tab{display:inline-flex;align-items:center;justify-content:center;min-width:92px;height:48px;padding:6px 14px}.provider-tab .brand-logo{display:flex;align-items:center;justify-content:center;position:relative;max-width:76px;height:30px;overflow:visible}.brand-netflix{width:32px}.netflix-n{display:block;color:#e50914;font-family:Arial Black,Arial,sans-serif;font-size:31px;font-weight:900;line-height:30px;letter-spacing:-4px;transform:scaleX(.82);transform-origin:center}.brand-disney{width:76px;color:#113ccf}.disney-word{position:relative;z-index:1;display:block;font-family:"Trebuchet MS",Arial,sans-serif;font-size:19px;font-weight:800;font-style:italic;letter-spacing:-1.5px;line-height:30px;white-space:nowrap}.disney-arc{position:absolute;left:7px;right:4px;top:2px;height:13px;border-top:2px solid currentColor;border-radius:60% 60% 0 0;transform:rotate(-7deg)}.brand-prime{width:70px;color:#00a8e1;flex-direction:column;gap:0}.brand-word{display:inline-flex;align-items:center;justify-content:center;width:auto;min-width:62px;max-width:92px;height:28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:900;line-height:1;white-space:nowrap;letter-spacing:-.35px}.brand-hbomax{color:#6b38ff}.brand-apple{color:#111}.brand-paramount{color:#1665d8}.brand-canal{color:#111;letter-spacing:-.7px}.brand-crunchy{color:#f47521;font-size:12px}.brand-mubi{color:#111;letter-spacing:1px}.brand-adn{color:#e72b35;font-size:18px}.prime-word{display:block;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;line-height:19px;letter-spacing:-.7px}.prime-smile{position:relative;display:block;width:50px;height:8px;border-bottom:2px solid currentColor;border-radius:0 0 60% 60%;transform:translateY(-1px) rotate(-3deg)}.prime-smile:after{content:"";position:absolute;right:-1px;bottom:-4px;width:6px;height:6px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-18deg)}.provider-tab.netflix{color:#e50914}.provider-tab.disney{color:#113ccf}.provider-tab.prime{color:#00a8e1}.provider-tab:not(.active){background:rgba(127,127,127,.12)}.provider-tab:not(.active) .brand-logo{opacity:.58;filter:saturate(.72)}.provider-tab.netflix.active{background:rgba(229,9,20,.14);box-shadow:inset 0 0 0 1px rgba(229,9,20,.28)}.provider-tab.disney.active{background:rgba(17,60,207,.14);box-shadow:inset 0 0 0 1px rgba(17,60,207,.28)}.provider-tab.prime.active{background:rgba(0,168,225,.15);box-shadow:inset 0 0 0 1px rgba(0,168,225,.3)}.provider-tab.hbo_max.active{background:rgba(107,56,255,.14);box-shadow:inset 0 0 0 1px rgba(107,56,255,.3)}.provider-tab.apple_tv.active{background:rgba(20,20,20,.10);box-shadow:inset 0 0 0 1px rgba(20,20,20,.24)}.provider-tab.paramount.active{background:rgba(22,101,216,.14);box-shadow:inset 0 0 0 1px rgba(22,101,216,.28)}.provider-tab.canal.active{background:rgba(20,20,20,.10);box-shadow:inset 0 0 0 1px rgba(20,20,20,.24)}.provider-tab.crunchyroll.active{background:rgba(244,117,33,.14);box-shadow:inset 0 0 0 1px rgba(244,117,33,.3)}.provider-tab.mubi.active{background:rgba(20,20,20,.10);box-shadow:inset 0 0 0 1px rgba(20,20,20,.24)}.provider-tab.adn.active{background:rgba(231,43,53,.14);box-shadow:inset 0 0 0 1px rgba(231,43,53,.28)}.media-tab{display:inline-flex;align-items:center;gap:7px}.media-tab ha-icon{--mdc-icon-size:20px}.modalbg{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px;overflow:auto}.modal{position:relative;box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-width:460px;max-height:calc(100dvh - 32px);overflow:auto;padding:20px;border-radius:22px;background:var(--card-background-color)}.modal-close{position:absolute;top:10px;right:10px;width:38px;height:38px;padding:0!important;border-radius:50%!important;display:grid;place-items:center;background:rgba(127,127,127,.18)!important;color:var(--primary-text-color)!important;font-size:25px!important;line-height:1!important;z-index:2}.modal-title-row{display:flex;align-items:center;gap:10px;padding-right:44px;margin:4px 0 12px}.modal-title-row h2{flex:0 1 auto;overflow-wrap:anywhere;padding:0;margin:0}.modal-title-row .age-badge{flex:0 0 auto}.modal-title-row .age-badge.fr{width:30px;height:30px;font-size:.68rem}.modal-title-row .age-badge.us{height:28px;min-width:44px;font-size:.68rem}.modal p{color:var(--secondary-text-color);line-height:1.45;overflow-wrap:anywhere}.modal .buttons{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center}.service-play{margin:12px 0 16px}.service-play.unavailable{padding:10px 12px;border-radius:14px;background:var(--secondary-background-color);text-align:center}.service-play.unavailable small{display:block;margin-top:6px;color:var(--secondary-text-color)}.service-heading{display:flex;align-items:center;justify-content:center;gap:8px}.service-heading .play-brand{display:flex;align-items:center;justify-content:center}.service-heading .brand-logo{max-width:70px;height:24px}.playrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:10px 0 0}.playrow button{min-width:0;min-height:76px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:9px 10px!important;color:#fff!important;border:1px solid transparent!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(8px);text-align:center}.playrow button *{color:#fff!important}.playrow .play-brand{display:flex;align-items:center;justify-content:center;height:22px;margin-bottom:2px}.playrow .play-brand .brand-logo{max-width:62px;height:22px;color:#fff}.playrow .play-brand .netflix-n{color:#fff;font-size:24px;line-height:22px}.playrow .play-brand .disney-word{font-size:15px;line-height:22px;color:#fff}.playrow .play-brand .disney-arc{border-color:#fff;top:0}.playrow .play-brand .prime-word{font-size:14px;line-height:15px;color:#fff}.playrow .play-brand .prime-smile{width:40px;height:6px;border-color:#fff}.playrow .play-brand .prime-smile:after{border-color:#fff}.playrow .playcopy{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.08;text-align:center;width:100%;transform:translateY(-3px)}.playrow .playcopy strong{font-size:.86rem;white-space:normal;text-align:center;color:#fff!important}.playrow .playcopy small{font-size:.92rem;margin-top:5px;opacity:1;font-weight:900;color:#fff!important}.playrow button.netflix{background:linear-gradient(rgba(229,9,20,.34),rgba(83,0,7,.42)),rgba(14,14,14,.82)!important;border-color:rgba(229,9,20,.55)!important}.playrow button.disney{background:linear-gradient(rgba(17,60,207,.34),rgba(5,18,61,.45)),rgba(10,18,36,.82)!important;border-color:rgba(53,104,235,.55)!important}.playrow button.prime{background:linear-gradient(rgba(0,168,225,.42),rgba(0,93,132,.38)),rgba(10,25,32,.78)!important;border-color:rgba(0,188,235,.58)!important}.playrow button:disabled{opacity:.45;cursor:not-allowed}.modal button,.modal a{box-sizing:border-box;border:0;border-radius:999px;padding:9px 13px;background:var(--secondary-background-color);color:var(--primary-text-color);font:inherit;font-weight:800;text-decoration:none;cursor:pointer}@media(max-width:600px){.wrap{padding:14px 11px}.provider-tabs,.media-tabs{justify-content:center;overflow:visible}.provider-tabs.many{justify-content:flex-start;overflow-x:auto}.rail{grid-auto-columns:minmax(140px,44vw)}.provider-tab{min-width:82px;height:46px;padding:6px 12px}.provider-tab .brand-logo{max-width:70px;height:28px}.provider-tab .disney-word{font-size:18px}.provider-tab .prime-word{font-size:17px}.modalbg{padding:16px}.modal{width:min(360px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);padding:14px;border-radius:18px}.modal-close{top:8px;right:8px;width:34px;height:34px;font-size:22px!important}.modal-title-row{gap:8px;padding-right:38px;margin:4px 0 10px}.modal-title-row h2{font-size:1.3rem}.modal-title-row .age-badge.fr{width:27px;height:27px;font-size:.62rem}.modal-title-row .age-badge.us{height:25px;min-width:41px;font-size:.61rem}.modal p{margin:0 0 10px;font-size:.91rem;line-height:1.38}.playrow{gap:8px;margin:12px 0 14px}.playrow button{min-height:72px;padding:8px!important}.playrow .playcopy strong{font-size:.78rem}.playrow .playcopy small{font-size:.9rem}.modal .buttons{gap:7px}.modal .buttons button,.modal .buttons a{padding:8px 11px;font-size:.88rem}}@media(max-width:360px){.playrow{grid-template-columns:1fr}.modal{width:calc(100vw - 24px);max-width:calc(100vw - 24px)}} </style><ha-card><div class="wrap"><div class="top"><div class="title">${this._esc(this._config.title)}</div><div class="updated">${upd}</div><div class="spacer"></div><button class="refresh">${this._loading?"…":"↻"}</button></div><div class="tabs provider-tabs ${this._providerOrder().length>4?"many":""}">${this._providerOrder().map(x=>`<button class="tab provider-tab ${x} ${this._provider===x?"active":""}" data-provider="${x}" title="${this._label(x)}" aria-label="${this._label(x)}">${this._providerLogo(x)}</button>`).join("")}</div><div class="tabs media-tabs"><button class="tab media-tab ${this._media==="movies"?"active":""}" data-media="movies"><ha-icon icon="mdi:filmstrip"></ha-icon><span>Films</span></button><button class="tab media-tab ${this._media==="tv"?"active":""}" data-media="tv"><ha-icon icon="mdi:television-play"></ha-icon><span>Séries</span></button></div><div class="tabs"><button class="tab ${this._section==="discover"?"active":""}" data-section="discover">À découvrir</button><button class="tab ${this._section==="watchlist"?"active":""}" data-section="watchlist">Ma liste <span class="count">${lc}</span></button><button class="tab ${this._section==="watched"?"active":""}" data-section="watched">Déjà vus <span class="count">${wc}</span></button><button class="tab ${this._section==="not_interested"?"active":""}" data-section="not_interested">Pas intéressé <span class="count">${nc}</span></button></div><div class="source">${this._section==="discover"?`${this._esc(p?.source_label||"")}${p?.week?` · semaine ${this._esc(p.week)}`:""}`:"Bibliothèque globale · toutes plateformes activées"}</div>${body}</div></ha-card>`;
    this._bind();
  }
  _bind(){
    const r=this.shadowRoot;
    r.querySelector('.refresh')?.addEventListener('click',()=>this._refresh());
    r.querySelectorAll('[data-provider]').forEach(b=>b.onclick=()=>{this._provider=b.dataset.provider;this._render()});
    r.querySelectorAll('[data-media]').forEach(b=>b.onclick=()=>{this._media=b.dataset.media;this._render()});
    r.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{this._section=b.dataset.section;this._render()});
    r.querySelectorAll('.ico').forEach(b=>b.onclick=async e=>{
      e.stopPropagation();const i=this._find(b.dataset.key);if(!i)return;
      if(b.dataset.act==='watched')await this._set(i,'watched',!this._watched().has(i.media_key));
      else if(b.dataset.act==='watchlist')await this._set(i,'watchlist',!this._watchlist().has(i.media_key));
      else if(b.dataset.act==='not_interested')await this._set(i,'not_interested',true);
      else if(b.dataset.act==='restore')await this._set(i,'not_interested',false);
    });
    r.querySelectorAll('.mcard').forEach(c=>c.onclick=()=>{const i=this._find(c.dataset.key);if(i)this._detail(i)});
  }
  _detail(i){
    this.shadowRoot.querySelector('.modalbg')?.remove();
    i=this._work(i);
    const w=this._watched().has(i.media_key),l=this._watchlist().has(i.media_key),n=this._notInterested().has(i.media_key),m=document.createElement('div');
    const disposition=n?`<button data-a="restore">↩ Remettre dans le flow</button><button data-a="watched">✓ Déjà vu</button>`:`<button data-a="watched">${w?"↩ Pas vu":"✓ Déjà vu"}</button><button data-a="watchlist">${l?"♥ Retirer":"♡ Ma liste"}</button><button data-a="not_interested">× Pas intéressé</button>`;
    const playBlock=this._playSections(i);
    const age=this._ageFor(i);
    const ageBadge=this._ageBadge(age.value,age.country);
    m.className='modalbg';m.innerHTML=`<div class="modal"><button class="modal-close" data-a="close" aria-label="Fermer" title="Fermer">×</button><div class="modal-title-row"><h2>${this._esc(i.title)}</h2>${ageBadge}</div><p>${this._esc(i.description||"Pas de synopsis disponible pour le moment.")}</p>${playBlock}<div class="buttons">${disposition}</div></div>`;
    m.onclick=e=>{if(e.target===m)m.remove()};
    m.querySelector('[data-a="close"]').onclick=()=>m.remove();
    m.querySelectorAll('[data-play-provider]').forEach(b=>b.addEventListener('click',async e=>{e.stopPropagation();await this._play(i,b.dataset.playProvider,b.dataset.player,b)}));
    m.querySelector('[data-a="watched"]')?.addEventListener('click',async()=>{m.remove();await this._set(i,'watched',n?true:!w)});
    m.querySelector('[data-a="watchlist"]')?.addEventListener('click',async()=>{m.remove();await this._set(i,'watchlist',!l)});
    m.querySelector('[data-a="not_interested"]')?.addEventListener('click',async()=>{m.remove();await this._set(i,'not_interested',true)});
    m.querySelector('[data-a="restore"]')?.addEventListener('click',async()=>{m.remove();await this._set(i,'not_interested',false)});
    this.shadowRoot.appendChild(m);
  }}
customElements.define('streaming-top-fr-card',StreamingTopFrCard);

class StreamingTopFrCatalogCard extends StreamingTopFrCard {
  setConfig(c){
    const hasLocalDefaultDecade=Object.prototype.hasOwnProperty.call(c||{},"default_decade");
    this._config={title:"Top Streaming",default_category:"movies",default_family_category:"movies",...c};
    this._configuredDefaultDecade=hasLocalDefaultDecade?String(c.default_decade):null;
    if(!this.shadowRoot)this.attachShadow({mode:"open"});
    this._decade=this._configuredDefaultDecade||"1990";
    this._defaultDecadeApplied=false;
    this._category=String(this._config.default_category||"movies");
    this._familyType=String(this._config.default_family_category||"movies");
    this._familyCache={};this._familyLoadingKey=null;this._familyError={};
    this._data=null;this._loading=false;this._error=null;this._render();
  }
  getCardSize(){return 6}
  async _load(){
    await super._load();
    if(!this._defaultDecadeApplied){
      const globalDefault=String(this._data?.settings?.top_catalog?.default_decade||"");
      this._decade=this._configuredDefaultDecade||globalDefault||this._decade||"1990";
      this._defaultDecadeApplied=true;
    }
    this._normalizeCatalogSelection();
    if(this._category==="family")await this._loadFamily();
    this._render();
  }
  async _refresh(){
    this._familyCache={};this._familyError={};this._familyLoadingKey=null;
    if(!this._configuredDefaultDecade)this._defaultDecadeApplied=false;
    await super._refresh();
  }
  _catalog(){return this._data?.top_catalog||null}
  _decadeOrder(){const v=this._catalog()?.decade_order;return Array.isArray(v)?v.map(String):[]}
  _decadeData(decade=this._decade){return this._catalog()?.decades?.[String(decade)]||null}
  _familySettings(){return this._data?.settings?.family||{enabled:true,target_age:11,allow_unrated:false,movies:true,animation:true,series:true}}
  _standardCategories(decade=this._decade){
    const d=this._decadeData(decade);if(!d)return[];
    const configured=this._catalog()?.category_order||["movies","animation","series"];
    return configured.filter(x=>["movies","animation","series"].includes(x)&&d?.categories?.[x]);
  }
  _familyTypes(decade=this._decade){
    const family=this._familySettings();if(family.enabled===false)return[];
    return this._standardCategories(decade).filter(x=>family?.[x]!==false);
  }
  _categories(decade=this._decade){
    const base=this._standardCategories(decade);
    if(this._familyTypes(decade).length)base.push("family");
    return base;
  }
  _normalizeCatalogSelection(){
    const decades=this._decadeOrder();
    if(decades.length&&!decades.includes(String(this._decade)))this._decade=decades.includes("1990")?"1990":decades[0];
    const cats=this._categories();
    if(cats.length&&!cats.includes(this._category))this._category=cats[0];
    const familyTypes=this._familyTypes();
    if(familyTypes.length&&!familyTypes.includes(this._familyType))this._familyType=familyTypes[0];
  }
  _familyKey(){return`${this._decade}:${this._familyType}`}
  _familyBranch(){return this._familyCache?.[this._familyKey()]||null}
  _catalogBranch(){return this._category==="family"?this._familyBranch():this._decadeData()?.categories?.[this._category]||null}
  _catalogItems(){
    const w=this._watched(),n=this._notInterested();
    return(this._catalogBranch()?.items||[]).filter(i=>!w.has(i.media_key)&&!n.has(i.media_key)).map((i,index)=>({...i,rank:index+1}));
  }
  _categoryLabel(id){return{movies:"Films",animation:"Animation",series:"Séries",family:"Famille"}[id]||id}
  _categoryIcon(id){return{movies:"mdi:filmstrip",animation:"mdi:creation",series:"mdi:television-play",family:"mdi:account-group"}[id]||"mdi:movie-open"}
  async _externalStatusRefresh(){
    this._familyCache={};this._familyError={};this._familyLoadingKey=null;
    await super._externalStatusRefresh();
  }
  async _set(item,status,enabled){
    if(!this._hass)return;
    const work=this._work(item);
    await this._hass.callWS({type:"streaming_top_fr/set_status",key:work.media_key,status,enabled,item:work});
    if(status==="watched"||status==="not_interested"){
      this._familyCache={};this._familyError={};this._familyLoadingKey=null;
    }
    await this._load();
    this._broadcastStatusChange();
  }
  async _loadFamily(force=false){
    if(!this._hass||this._category!=="family")return;
    const key=this._familyKey();
    if(!force&&this._familyCache[key])return;
    if(this._familyLoadingKey===key)return;
    this._familyLoadingKey=key;delete this._familyError[key];this._render();
    try{
      const result=await this._hass.callWS({type:"streaming_top_fr/get_family_catalog",decade:Number(this._decade),category:this._familyType});
      this._familyCache[key]=result||{items:[]};delete this._familyError[key];
    }catch(e){this._familyError[key]=String(e)}finally{if(this._familyLoadingKey===key)this._familyLoadingKey=null;this._render()}
  }
  async _detail(i){
    let item=i;
    const cfg=this._data?.settings?.classification||{};
    const needsAge=cfg.enabled!==false&&!item?.age_fr&&!item?.age_us&&!item?.age_certification;
    const needsPoster=item?.poster_source!=="imdb";
    if((needsAge||needsPoster)&&this._hass){
      try{
        const enriched=await this._hass.callWS({type:"streaming_top_fr/enrich_item",item});
        if(enriched&&typeof enriched==="object"){
          item={...item,...enriched};
          const idx=(this._currentItems||[]).findIndex(x=>x.media_key===item.media_key);
          if(idx>=0)this._currentItems[idx]=item;
        }
      }catch(e){/* classification is optional; open the popup anyway */}
    }
    return super._detail(item);
  }
  _catalogCard(i){
    const rating=i.rating!=null?`★ ${Number(i.rating).toFixed(1)} IMDb`:"";
    const votes=Number(i.imdb_votes||0);
    const voteText=votes>=1000000?`${(votes/1000000).toFixed(votes>=10000000?0:1).replace(".0","")} M votes`:votes>=1000?`${Math.round(votes/1000)} k votes`:votes?`${votes} votes`:"";
    const meta=[i.year,rating,voteText].filter(Boolean).join('<span class="sep">·</span>');
    const rank=(i.rank!==null&&i.rank!==undefined&&Number(i.rank)>0)?`<span class="rank">#${this._esc(i.rank)}</span>`:"";
    return `<article class="mcard" data-key="${this._esc(i.media_key)}"><div class="poster">${i.poster?`<img src="${this._esc(i.poster)}" loading="lazy">`:`<div class="fallback">${this._esc((i.title||"?")[0])}</div>`}${rank}<div class="actions">${this._actionButtons(i)}</div></div><div class="info"><b>${this._esc(i.title)}</b><em class="meta-line">${meta}</em></div></article>`;
  }
  _bindCatalog(){
    const r=this.shadowRoot;
    r.querySelector('.refresh')?.addEventListener('click',()=>this._refresh());
    r.querySelectorAll('[data-decade]').forEach(b=>b.onclick=async()=>{this._decade=b.dataset.decade;this._normalizeCatalogSelection();this._render();if(this._category==="family")await this._loadFamily()});
    r.querySelectorAll('[data-category]').forEach(b=>b.onclick=async()=>{this._category=b.dataset.category;this._normalizeCatalogSelection();this._render();if(this._category==="family")await this._loadFamily()});
    r.querySelectorAll('[data-family-type]').forEach(b=>b.onclick=async()=>{this._familyType=b.dataset.familyType;this._render();await this._loadFamily()});
    r.querySelectorAll('.ico').forEach(b=>b.onclick=async e=>{
      e.stopPropagation();const i=this._find(b.dataset.key);if(!i)return;
      if(b.dataset.act==='watched')await this._set(i,'watched',!this._watched().has(i.media_key));
      else if(b.dataset.act==='watchlist')await this._set(i,'watchlist',!this._watchlist().has(i.media_key));
      else if(b.dataset.act==='not_interested')await this._set(i,'not_interested',true);
      else if(b.dataset.act==='restore')await this._set(i,'not_interested',false);
    });
    r.querySelectorAll('.mcard').forEach(c=>c.onclick=()=>{const i=this._find(c.dataset.key);if(i)this._detail(i)});
  }
  _render(){
    if(!this.shadowRoot)return;
    this._normalizeCatalogSelection();
    const catalog=this._catalog();const decades=this._decadeOrder();const cats=this._categories();const branch=this._catalogBranch();
    const items=this._catalogItems();this._currentItems=items;
    const familyTypes=this._familyTypes();const familyKey=this._familyKey();const familyLoading=this._category==="family"&&this._familyLoadingKey===familyKey;
    let body;
    if(this._loading&&!this._data)body='<div class="state">Chargement du classement…</div>';
    else if(this._error)body=`<div class="state err">${this._esc(this._error)}</div>`;
    else if(catalog?.enabled===false)body='<div class="state">La carte Top Streaming est désactivée dans streaming_top_fr.yaml.</div>';
    else if(!decades.length)body=`<div class="state">${this._esc(catalog?.error||"Aucune décennie activée dans la configuration.")}</div>`;
    else if(this._category==="family"&&familyLoading&&!items.length)body='<div class="state">Recherche des contenus Famille et vérification des classifications d’âge…</div>';
    else if(this._category==="family"&&this._familyError[familyKey]&&!items.length)body=`<div class="state err"><b>Filtre Famille indisponible</b><br>${this._esc(this._familyError[familyKey])}</div>`;
    else if(branch?.error&&!items.length)body=`<div class="state err"><b>Classement indisponible</b><br>${this._esc(branch.error)}</div>`;
    else if(items.length)body=`<div class="rail">${items.map(i=>this._catalogCard(i)).join("")}</div>`;
    else body='<div class="state">Aucun titre disponible pour cette sélection.</div>';
    const upd=this._data?.updated_at?new Date(this._data.updated_at).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";
    const topCount=this._decadeData()?.top_count||"";
    const family=this._familySettings();
    const source=this._category==="family"?`Famille · âge cible ${family.target_age??11} ans · FR prioritaire${(this._data?.settings?.classification?.us_fallback!==false)?" · US fallback":""}`:(catalog?.source_label||"Popularité FR → qualité IMDb · disponibilité JustWatch France");
    const familyTabs=`<div class="tabs family-tabs ${this._category==="family"?"":"reserved"}" ${this._category==="family"?"":'aria-hidden="true"'}>${this._category==="family"?familyTypes.map(c=>`<button class="tab family-tab ${this._familyType===c?"active":""}" data-family-type="${this._esc(c)}"><ha-icon icon="${this._categoryIcon(c)}"></ha-icon><span>${this._esc(this._categoryLabel(c))}</span></button>`).join(""):""}</div>`;
    this.shadowRoot.innerHTML=`<style>
:host{display:block}ha-card{overflow:hidden}.wrap{padding:18px}.top{display:flex;align-items:center;gap:12px}.title{font-size:1.2rem;font-weight:850}.updated,.source{color:var(--secondary-text-color);font-size:.72rem}.spacer{flex:1}.refresh{border:0;border-radius:50%;width:38px;height:38px;background:var(--secondary-background-color);color:var(--primary-text-color);font-size:18px;cursor:pointer}.tabs{display:flex;gap:8px;overflow:auto;margin-top:12px;scrollbar-width:none}.decade-tabs,.category-tabs,.family-tabs{justify-content:center}.tab{border:0;border-radius:999px;padding:9px 14px;font:inherit;font-weight:800;background:var(--secondary-background-color);color:var(--secondary-text-color);white-space:nowrap;cursor:pointer}.tab.active{background:var(--primary-color);color:#fff}.category-tab,.family-tab{display:inline-flex;align-items:center;gap:7px}.category-tab ha-icon,.family-tab ha-icon{--mdc-icon-size:20px}.family-tabs{margin-top:8px;min-height:38px}.family-tabs.reserved{visibility:hidden;pointer-events:none}.family-tab{padding:7px 12px;font-size:.88rem}.source{margin:12px 0}.rail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(155px,175px);gap:13px;overflow-x:auto;padding:2px 2px 12px}.mcard{overflow:hidden;border-radius:18px;background:var(--card-background-color);box-shadow:0 3px 12px rgba(0,0,0,.16);cursor:pointer}.poster{position:relative;aspect-ratio:2/3;background:#222}.poster img,.fallback{width:100%;height:100%;object-fit:cover}.fallback{display:grid;place-items:center;font-size:4rem;font-weight:900;background:linear-gradient(145deg,#343741,#14151a);color:#777}.rank{position:absolute;left:8px;top:8px;padding:5px 8px;border-radius:999px;background:rgba(0,0,0,.78);color:#fff;font-size:.7rem;font-weight:900}.actions{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:6px}.ico{border:0;width:35px;height:35px;border-radius:50%;background:rgba(0,0,0,.76);color:#fff;font-size:17px;cursor:pointer}.ico.on{background:var(--primary-color)}.ico.reject{font-size:23px}.ico.reject.on{background:#b3261e}.ico.restore{font-size:19px;background:#325d3a}.info{padding:10px 11px 12px;min-height:68px}.info b{display:block;line-height:1.2}.info em{display:block;color:var(--secondary-text-color);font-size:.7rem;margin-top:4px;font-style:normal}.meta-line{display:flex!important;align-items:center;gap:5px;white-space:nowrap;overflow:hidden}.meta-line .sep{opacity:.7}.state{padding:34px 8px;text-align:center;color:var(--secondary-text-color);line-height:1.5}.err{color:var(--error-color,#d93025)}
.age-badge{display:inline-grid;place-items:center;flex:0 0 auto;box-sizing:border-box;font-weight:900;line-height:1;vertical-align:middle}.age-badge.fr{width:29px;height:29px;border-radius:50%;background:#d9d9d9!important;color:#111!important;border:0!important;font-size:.66rem}.age-badge.us{min-width:42px;height:26px;padding:0 7px;border-radius:6px;background:#242424!important;color:#fff!important;border:0!important;font-size:.64rem}
.brand-logo{display:flex;align-items:center;justify-content:center;position:relative;max-width:76px;height:30px;overflow:visible}.brand-netflix{width:32px}.netflix-n{display:block;color:#e50914;font-family:Arial Black,Arial,sans-serif;font-size:31px;font-weight:900;line-height:30px;letter-spacing:-4px;transform:scaleX(.82)}.brand-disney{width:76px;color:#113ccf}.disney-word{position:relative;z-index:1;display:block;font-family:"Trebuchet MS",Arial,sans-serif;font-size:19px;font-weight:800;font-style:italic;letter-spacing:-1.5px;line-height:30px;white-space:nowrap}.disney-arc{position:absolute;left:7px;right:4px;top:2px;height:13px;border-top:2px solid currentColor;border-radius:60% 60% 0 0;transform:rotate(-7deg)}.brand-prime{width:70px;color:#00a8e1;flex-direction:column}.brand-word{display:inline-flex;align-items:center;justify-content:center;width:auto;min-width:62px;max-width:92px;height:28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:900;white-space:nowrap}.brand-hbomax{color:#6b38ff}.brand-apple{color:#111}.brand-paramount{color:#1665d8}.brand-canal{color:#111}.brand-crunchy{color:#f47521;font-size:12px}.brand-mubi{color:#111}.brand-adn{color:#e72b35;font-size:18px}.prime-word{display:block;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;line-height:19px}.prime-smile{position:relative;display:block;width:50px;height:8px;border-bottom:2px solid currentColor;border-radius:0 0 60% 60%;transform:translateY(-1px) rotate(-3deg)}.prime-smile:after{content:"";position:absolute;right:-1px;bottom:-4px;width:6px;height:6px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-18deg)}
.modalbg{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px;overflow:auto}.modal{position:relative;box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-width:460px;max-height:calc(100dvh - 32px);overflow:auto;padding:20px;border-radius:22px;background:var(--card-background-color)}.modal-close{position:absolute;top:10px;right:10px;width:38px;height:38px;padding:0!important;border-radius:50%!important;display:grid;place-items:center;background:rgba(127,127,127,.18)!important;color:var(--primary-text-color)!important;font-size:25px!important;line-height:1!important;z-index:2}.modal-title-row{display:flex;align-items:center;gap:10px;padding-right:44px;margin:4px 0 12px}.modal-title-row h2{flex:0 1 auto;overflow-wrap:anywhere;padding:0;margin:0}.modal-title-row .age-badge{flex:0 0 auto}.modal p{color:var(--secondary-text-color);line-height:1.45;overflow-wrap:anywhere}.modal .buttons{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center}.service-play{margin:12px 0 16px}.service-play.unavailable{padding:10px 12px;border-radius:14px;background:var(--secondary-background-color);text-align:center}.service-play.unavailable small{display:block;margin-top:6px;color:var(--secondary-text-color)}.service-heading{display:flex;align-items:center;justify-content:center;gap:8px}.playrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:10px 0 0}.playrow button{min-width:0;min-height:76px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:9px 10px!important;color:#fff!important;border:1px solid transparent!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(8px);text-align:center}.playrow button *{color:#fff!important}.playrow .play-brand{display:flex;align-items:center;justify-content:center;height:22px;margin-bottom:2px}.playrow .play-brand .brand-logo{max-width:62px;height:22px;color:#fff}.playrow .play-brand .netflix-n{color:#fff;font-size:24px;line-height:22px}.playrow .play-brand .disney-word{font-size:15px;line-height:22px;color:#fff}.playrow .play-brand .disney-arc{border-color:#fff;top:0}.playrow .play-brand .prime-word{font-size:14px;line-height:15px;color:#fff}.playrow .play-brand .prime-smile{width:40px;height:6px;border-color:#fff}.playrow .play-brand .prime-smile:after{border-color:#fff}.playrow .playcopy{min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.08;text-align:center;width:100%;transform:translateY(-3px)}.playrow .playcopy strong{font-size:.86rem;white-space:normal;text-align:center;color:#fff!important}.playrow .playcopy small{font-size:.92rem;margin-top:5px;opacity:1;font-weight:900;color:#fff!important}.playrow button.netflix{background:linear-gradient(rgba(229,9,20,.34),rgba(83,0,7,.42)),rgba(14,14,14,.82)!important;border-color:rgba(229,9,20,.55)!important}.playrow button.disney{background:linear-gradient(rgba(17,60,207,.34),rgba(5,18,61,.45)),rgba(10,18,36,.82)!important;border-color:rgba(53,104,235,.55)!important}.playrow button.prime{background:linear-gradient(rgba(0,168,225,.42),rgba(0,93,132,.38)),rgba(10,25,32,.78)!important;border-color:rgba(0,188,235,.58)!important}.playrow button:disabled{opacity:.45;cursor:not-allowed}.modal button,.modal a{box-sizing:border-box;border:0;border-radius:999px;padding:9px 13px;background:var(--secondary-background-color);color:var(--primary-text-color);font:inherit;font-weight:800;text-decoration:none;cursor:pointer}
@media(max-width:600px){.wrap{padding:14px 11px}.decade-tabs,.category-tabs,.family-tabs{justify-content:flex-start;overflow-x:auto}.rail{grid-auto-columns:minmax(140px,44vw)}.modalbg{padding:16px}.modal{width:min(360px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);padding:14px;border-radius:18px}.modal-close{top:8px;right:8px;width:34px;height:34px;font-size:22px!important}.modal-title-row{gap:8px;padding-right:38px;margin:4px 0 10px}.modal-title-row h2{font-size:1.3rem}.playrow{gap:8px}.playrow button{min-height:72px;padding:8px!important}}@media(max-width:360px){.playrow{grid-template-columns:1fr}.modal{width:calc(100vw - 24px);max-width:calc(100vw - 24px)}}
</style><ha-card><div class="wrap"><div class="top"><div class="title">${this._esc(this._config.title)}</div><div class="updated">${upd}</div><div class="spacer"></div><button class="refresh">${this._loading?"…":"↻"}</button></div><div class="tabs decade-tabs">${decades.map(d=>`<button class="tab ${String(this._decade)===String(d)?"active":""}" data-decade="${this._esc(d)}">${this._esc(d)}</button>`).join("")}</div><div class="tabs category-tabs">${cats.map(c=>`<button class="tab category-tab ${this._category===c?"active":""}" data-category="${this._esc(c)}"><ha-icon icon="${this._categoryIcon(c)}"></ha-icon><span>${this._esc(this._categoryLabel(c))}</span></button>`).join("")}</div>${familyTabs}<div class="source">${topCount?`Top ${this._esc(topCount)} · `:""}${this._esc(source)}</div>${body}</div></ha-card>`;
    this._bindCatalog();
  }
}
customElements.define('streaming-top-fr-catalog-card',StreamingTopFrCatalogCard);

// v0.9.0-beta.1 optional direct playback layer.
// Keep the validated historical card classes untouched: this wrapper only
// suppresses playback controls when the user explicitly disables playback.
const _stfrHistoricalPlaySections=StreamingTopFrCard.prototype._playSections;
StreamingTopFrCard.prototype._directPlaybackEnabled=function(){
  const playback=this._data?.settings?.playback;
  if(playback&&Object.prototype.hasOwnProperty.call(playback,"enabled")){
    return playback.enabled!==false;
  }
  // Backward compatibility for pre-0.9.0-beta.1 settings.
  return this._players().length>0;
};
StreamingTopFrCard.prototype._playSections=function(item){
  if(!this._directPlaybackEnabled())return"";
  return _stfrHistoricalPlaySections.call(this,item);
};


// v1.0.1-beta.8: bridge Streaming/Top popups to an already indexed Local copy.
// The historical cards remain untouched; lookup and playback are added as a
// prototype layer so the stable Streaming engine stays byte-for-byte protected.
StreamingTopFrCard.prototype._localCopyPlayers=function(item){
  const cfg=item?._local_playback||{};
  const players=Array.isArray(cfg.players)?cfg.players:[];
  return cfg.enabled===true?players:[];
};
StreamingTopFrCard.prototype._localCopyPlaySection=function(item){
  const match=item?._local_copy;
  const players=this._localCopyPlayers(item);
  if(!match?.local_id||!players.length)return"";
  const buttons=players.map(player=>`<button class="vlc" data-stream-local-id="${this._esc(match.local_id)}" data-stream-local-player="${this._esc(player.id)}" style="background:linear-gradient(rgba(196,72,31,.32),rgba(91,34,22,.42)),rgba(20,16,14,.82)!important;border-color:rgba(222,86,44,.58)!important"><span class="play-brand"><ha-icon icon="mdi:vlc"></ha-icon></span><span class="playcopy"><strong>Voir sur VLC</strong><small>${this._esc(player.name||player.id)}</small></span></button>`).join("");
  return `<div class="service-play local-vlc"><div class="playrow">${buttons}</div></div>`;
};
StreamingTopFrCard.prototype._playLocalCopy=async function(localId,playerId,button){
  if(!this._hass||!localId||!playerId)return;
  const old=button?.innerHTML;
  if(button){
    button.disabled=true;
    button.innerHTML='<span class="play-brand"><ha-icon icon="mdi:loading"></ha-icon></span><span class="playcopy"><strong>Lancement…</strong></span>';
  }
  try{
    await this._hass.callWS({
      type:"streaming_top_fr/play_local",
      local_id:localId,
      player:playerId,
    });
    if(button){
      button.innerHTML='<span class="play-brand"><ha-icon icon="mdi:check"></ha-icon></span><span class="playcopy"><strong>Lancé</strong></span>';
    }
  }catch(e){
    if(button){
      button.disabled=false;
      button.innerHTML=old||"Voir sur VLC";
    }
    this._error=`VLC : ${String(e)}`;
  }
};

const _stfrPlaySectionsBeforeLocalCopy=StreamingTopFrCard.prototype._playSections;
StreamingTopFrCard.prototype._playSections=function(item){
  return _stfrPlaySectionsBeforeLocalCopy.call(this,item)+this._localCopyPlaySection(item);
};

const _stfrDetailBeforeLocalCopy=StreamingTopFrCard.prototype._detail;
StreamingTopFrCard.prototype._detail=async function(item){
  let resolved=item;
  const requestItem={
    media_type:item?.media_type||null,
    media_key:item?.media_key||null,
    imdb_id:item?.imdb_id||null,
    title:item?.title||null,
    original_title:item?.original_title||null,
    subtitle:item?.subtitle||null,
    year:item?.year??null,
  };
  let localDiagnostic={
    frontend_version:STFR_VERSION,
    request_sent:false,
    request_item:requestItem,
    websocket_error:null,
    response_received:false,
  };
  if(this._hass&&String(item?.media_type||"").toLowerCase()==="movie"){
    try{
      localDiagnostic.request_sent=true;
      const local=await this._hass.callWS({
        type:"streaming_top_fr/find_local_copy",
        item:requestItem,
      });
      localDiagnostic={
        ...localDiagnostic,
        response_received:true,
        backend:local?.diagnostic||null,
        match:local?.match||null,
        local_playback:local?.local_playback||null,
      };
      resolved={
        ...item,
        _local_copy:local?.match||null,
        _local_playback:local?.local_playback||null,
        _local_diagnostic:localDiagnostic,
      };
    }catch(e){
      localDiagnostic.websocket_error={
        string:String(e),
        name:e?.name??null,
        message:e?.message??null,
        code:e?.code??null,
        details:e?.details??null,
        body:e?.body??null,
        raw:(e&&typeof e==="object")
          ?Object.fromEntries(Object.entries(e).map(([k,v])=>[
              k,
              (v&&typeof v==="object")?JSON.parse(JSON.stringify(v)):v
            ]))
          :e,
      };
      resolved={
        ...item,
        _local_copy:null,
        _local_playback:null,
        _local_diagnostic:localDiagnostic,
      };
    }
  }else{
    resolved={...item,_local_diagnostic:localDiagnostic};
  }

  const result=await _stfrDetailBeforeLocalCopy.call(this,resolved);
  const modal=this.shadowRoot?.querySelector(".modalbg");
  const diagnostic=resolved?._local_diagnostic;
  const debugEnabled=this._data?.settings?.debug?.enabled===true;
  if(modal&&diagnostic&&debugEnabled){
    const panel=document.createElement("details");
    panel.className="stream-local-diagnostic";
    panel.style.cssText="margin:14px 0;border-top:1px solid var(--divider-color);border-bottom:1px solid var(--divider-color);padding:8px 0";
    const summary=document.createElement("summary");
    summary.textContent="Détails techniques — correspondance Local";
    summary.style.cssText="cursor:pointer;font-weight:800;color:var(--secondary-text-color)";
    const pre=document.createElement("pre");
    pre.textContent=JSON.stringify(diagnostic,null,2);
    pre.style.cssText="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.72rem;line-height:1.35;max-height:260px;overflow:auto;background:var(--secondary-background-color);padding:10px;border-radius:10px";
    panel.append(summary,pre);
    const buttons=modal.querySelector(".buttons");
    const target=buttons?.parentElement||modal.querySelector(".modal")||modal;
    if(buttons)target.insertBefore(panel,buttons);else target.appendChild(panel);
  }
  modal?.querySelectorAll("[data-stream-local-id][data-stream-local-player]").forEach(button=>{
    button.addEventListener("click",async event=>{
      event.stopPropagation();
      await this._playLocalCopy(
        button.dataset.streamLocalId,
        button.dataset.streamLocalPlayer,
        button
      );
    });
  });
  return result;
};

class StreamingLocalCard extends HTMLElement {
  setConfig(c){
    this._config={title:"Streaming Local",default_category:"movies",...c};
    if(!this.shadowRoot)this.attachShadow({mode:"open"});
    this._category=String(this._config.default_category||"movies");
    this._data=null;this._loading=false;this._enriching=false;this._error=null;
    this._render();
  }
  set hass(h){
    this._hass=h;
    if(!this._data&&!this._loading)this._load(false);
  }
  getCardSize(){return 6}
  _esc(s){return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
  _categories(){
    // Keep all library sections visible, even when a category currently has
    // zero items. This makes scan/classification problems immediately visible
    // instead of silently hiding the missing category.
    return ["movies","series","animation","documentaries"];
  }
  _label(cat){return{movies:"Films",series:"Séries",animation:"Animation",documentaries:"Documentaires"}[cat]||cat}
  _icon(cat){return{movies:"mdi:filmstrip",series:"mdi:television-play",animation:"mdi:creation",documentaries:"mdi:earth"}[cat]||"mdi:movie-open"}
  _collectionKey(item){
    const parts=String(item?.relative_path||"").split("/").filter(Boolean);
    if(parts.length<3)return null;
    return parts.slice(0,2).join("/").toLocaleLowerCase("fr");
  }
  _sortMovieCollections(items){
    const source=[...(items||[])];
    const groups=new Map();
    for(const item of source){
      const key=this._collectionKey(item);
      if(!key)continue;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(item);
    }
    const sorted=new Map();
    for(const [key,group] of groups.entries()){
      if(group.length<2)continue;
      sorted.set(key,[...group].sort((a,b)=>{
        const ay=Number(a?.year),by=Number(b?.year);
        const aYear=Number.isFinite(ay)&&ay>0?ay:Number.MAX_SAFE_INTEGER;
        const bYear=Number.isFinite(by)&&by>0?by:Number.MAX_SAFE_INTEGER;
        return aYear-bYear||
          String(a?.title||a?.parsed_title||a?.filename||"").localeCompare(
            String(b?.title||b?.parsed_title||b?.filename||""),"fr"
          );
      }));
    }
    if(!sorted.size)return source;
    const cursor=new Map();
    return source.map(item=>{
      const key=this._collectionKey(item),group=key?sorted.get(key):null;
      if(!group)return item;
      const index=cursor.get(key)||0;
      cursor.set(key,index+1);
      return group[index]||item;
    });
  }
  _rawItems(category=this._category){
    const items=(this._data?.items||[]).filter(i=>i.bucket===category);
    return category==="movies"?this._sortMovieCollections(items):items;
  }
  _episodicSeasonGroups(category){
    const raw=this._rawItems(category);
    const standalone=[];
    const groups=new Map();

    for(const item of raw){
      const episodic=item?.episodic===true||
        (item?.season!==null&&item?.season!==undefined&&
         item?.episode!==null&&item?.episode!==undefined);
      if(!episodic){
        standalone.push(item);
        continue;
      }

      const fallbackTitle=String(
        item.parsed_title||item.title||item.filename||""
      ).trim().toLocaleLowerCase("fr");
      const seriesKey=String(
        item.imdb_id||item.canonical_media_key||
        `series:${category}:${fallbackTitle}`
      ).trim();
      const season=Number(item.season??0);
      const seasonKey=`${seriesKey}:season:${season}`;
      if(!groups.has(seasonKey)){
        groups.set(seasonKey,{seriesKey,season,episodes:[]});
      }
      groups.get(seasonKey).episodes.push(item);
    }

    const seasons=[];
    for(const [seasonKey,group] of groups.entries()){
      const episodes=group.episodes;
      episodes.sort((a,b)=>
        Number(a.episode??0)-Number(b.episode??0)||
        String(a.relative_path||"").localeCompare(
          String(b.relative_path||""),"fr"
        )
      );

      // The representative is deliberately chosen inside this season.
      // If a season-specific poster becomes available, it is therefore
      // naturally used instead of a poster taken from another season.
      const representative=
        episodes.find(i=>i.poster&&i.rating!=null)||
        episodes.find(i=>i.poster)||
        episodes.find(i=>i.metadata_status==="matched")||
        episodes[0];

      const franchiseTitle=String(
        representative.title||
        representative.franchise_title||
        representative.parsed_title||
        ""
      ).trim();
      const episodeTitles=[...new Set(
        episodes
          .map(ep=>String(ep.episode_title||"").trim())
          .filter(Boolean)
      )];
      const seasonTitle=episodeTitles.length===1?episodeTitles[0]:null;

      seasons.push({
        ...representative,
        is_season_group:true,
        series_key:group.seriesKey,
        season_key:seasonKey,
        franchise_title:franchiseTitle,
        season_title:seasonTitle,
        episodes,
        episode_count:episodes.length,
        season:group.season,
        episode:null,
        filename:null,
        relative_path:null,
        smb_uri:null,
      });
    }

    const combined=[...standalone,...seasons];
    return combined.sort((a,b)=>{
      const at=String(a.title||a.parsed_title||a.filename||"");
      const bt=String(b.title||b.parsed_title||b.filename||"");
      return at.localeCompare(bt,"fr")||
        Number(a.season??-1)-Number(b.season??-1);
    });
  }
  _displayItems(category=this._category){
    return ["series","animation","documentaries"].includes(category)
      ?this._episodicSeasonGroups(category)
      :this._rawItems(category);
  }
  _items(){return this._displayItems()}
  _categoryCount(cat){return this._displayItems(cat).length}
  _normalizeCategory(){
    const cats=this._categories();
    if(cats.length&&!cats.includes(this._category))this._category=cats[0];
  }
  async _load(refresh=false){
    if(!this._hass||this._loading)return;
    this._loading=true;this._error=null;this._render();
    try{
      this._data=await this._hass.callWS({type:"streaming_top_fr/get_local_library",refresh:Boolean(refresh)});
      this._normalizeCategory();
    }catch(e){this._error=String(e)}
    finally{this._loading=false;this._render()}
    if(this._data?.enabled&&this._data?.count>0&&!this._data?.metadata_complete&&!this._enriching){
      void this._enrich();
    }
  }
  async _enrich(){
    if(!this._hass||this._enriching)return;
    this._enriching=true;this._render();
    let retry=false;
    try{
      const result=await this._hass.callWS({type:"streaming_top_fr/enrich_local_library"});
      const currentRevision=Number(this._data?.scan_revision||0);
      const resultRevision=Number(result?.scan_revision||0);

      // Never let an enrichment started from an older filesystem snapshot
      // restore files that a later rescan has already removed or moved.
      if(resultRevision&&currentRevision&&resultRevision<currentRevision){
        retry=Boolean(this._data?.enabled&&this._data?.count>0&&!this._data?.metadata_complete);
      }else{
        this._data={...(this._data||{}),...(result||{})};
        this._normalizeCategory();
        this._error=null;
        retry=Boolean(result?.stale&&this._data?.enabled&&this._data?.count>0&&!this._data?.metadata_complete);
      }
    }catch(e){this._error=String(e)}
    finally{
      this._enriching=false;this._render();
      if(retry)void this._enrich();
    }
  }
  async _refresh(){await this._load(true)}
  _metadata(item){
    const parts=[];
    if(item.is_season_group){
      if(item.year)parts.push(String(item.year));
    }else if(item.media_type==="tv"&&item.season!=null&&item.episode!=null){
      parts.push(`S${String(item.season).padStart(2,"0")}E${String(item.episode).padStart(2,"0")}`);
    }else if(item.year){parts.push(String(item.year))}
    if(item.rating!=null){
      const n=Number(item.rating);
      parts.push(`★ ${Number.isFinite(n)?n.toFixed(1):this._esc(item.rating)}`);
    }
    if(item.age_certification)parts.push(String(item.age_certification));
    return parts.join(" · ");
  }
  _status(item){
    if(item.metadata_status==="matched")return "";
    if(item.metadata_status==="imdb_only")return '<span class="match imdb">IMDb</span>';
    if(item.metadata_status==="unmatched")return '<span class="match unmatched">À identifier</span>';
    return this._enriching?'<span class="match pending">Analyse…</span>':'';
  }
  _tile(item,index){
    const poster=item.poster
      ?`<img src="${this._esc(item.poster)}" alt="${this._esc(item.title||item.filename||"")}" loading="lazy">`
      :'<div class="poster-fallback"><ha-icon icon="mdi:movie-open-outline"></ha-icon></div>';
    const meta=this._metadata(item);
    const title=item.title||item.parsed_title||item.filename||"Sans titre";
    const seriesExtra=item.is_season_group
      ?`Saison ${item.season??"?"} · ${item.episode_count} épisode${item.episode_count>1?"s":""}`
      :"";
    return `<button class="media" data-index="${index}" title="${this._esc(item.filename||title)}">
      <div class="poster">${poster}${this._status(item)}</div>
      <div class="media-title">${this._esc(title)}</div>
      <div class="media-meta">${this._esc(meta)}</div>
      ${seriesExtra?`<div class="series-extra">${this._esc(seriesExtra)}</div>`:""}
    </button>`;
  }
  _seasonDetail(item){
    const old=this.shadowRoot.querySelector(".modalbg");if(old)old.remove();
    const episodes=[...(item.episodes||[])].sort((a,b)=>
      Number(a.episode??0)-Number(b.episode??0)||
      String(a.relative_path||"").localeCompare(String(b.relative_path||""),"fr")
    );
    const selectionKey=item.season_key||`${item.series_key||"series"}:season:${item.season??0}`;
    const selectedId=this._seriesSelection?.[selectionKey]||null;
    const m=document.createElement("div");m.className="modalbg";
    const franchise=item.franchise_title||item.title||item.parsed_title||"Sans titre";
    const storyTitle=item.season_title||"";
    const meta=this._metadata(item);
    const match=item.metadata_status==="matched"
      ?"JustWatch + IMDb"
      :item.metadata_status==="imdb_only"
      ?"IMDb uniquement"
      :"Non identifié";
    const episodeRows=episodes.map((ep,index)=>{
      const epNo=ep.episode!=null?Number(ep.episode):index+1;
      const code=ep.season!=null&&ep.episode!=null
        ?`S${String(ep.season).padStart(2,"0")}E${String(ep.episode).padStart(2,"0")}`
        :`Épisode ${epNo}`;
      const selected=selectedId&&selectedId===ep.local_id;
      const displayTitle=ep.episode_title||storyTitle||`Épisode ${epNo}`;
      return `<button class="episode-row ${selected?"selected":""}" data-episode-index="${index}">
        <span class="episode-main"><strong>${this._esc(code)}</strong><small>${this._esc(displayTitle)}</small></span>
        <ha-icon icon="${selected?"mdi:check-circle":"mdi:play-circle-outline"}"></ha-icon>
      </button>`;
    }).join("");
    m.innerHTML=`<div class="modal series-modal">
      <button class="modal-close" aria-label="Fermer">×</button>
      <div class="modal-head">
        ${item.poster?`<img src="${this._esc(item.poster)}" alt="">`:""}
        <div>
          <h2>${this._esc(franchise)}</h2>
          ${storyTitle?`<div class="season-story-title">${this._esc(storyTitle)}</div>`:""}
          <div class="modal-meta">${this._esc(meta)}</div>
          <div class="series-summary">Saison ${this._esc(item.season??"?")} · ${item.episode_count} épisode${item.episode_count>1?"s":""}</div>
        </div>
      </div>
      <p>${this._esc(item.description||"Aucun synopsis disponible pour le moment.")}</p>
      <div class="details">
        <div class="detail-row"><strong>Identification</strong><span>${this._esc(match)}</span></div>
      </div>
      <div class="episode-list">${episodeRows||'<div class="state">Aucun épisode détecté pour cette saison.</div>'}</div>
      <div class="episode-help">Sélectionnez l’épisode à lire. Seuls les épisodes réellement présents dans la vidéothèque sont affichés.</div>
    </div>`;
    m.onclick=e=>{if(e.target===m)m.remove()};
    m.querySelector(".modal-close").onclick=()=>m.remove();
    m.querySelectorAll("[data-episode-index]").forEach(b=>b.addEventListener("click",()=>{
      const ep=episodes[Number(b.dataset.episodeIndex)];
      if(!ep)return;
      this._seriesSelection=this._seriesSelection||{};
      this._seriesSelection[selectionKey]=ep.local_id;
      this._seasonDetail(item);
    }));
    this.shadowRoot.appendChild(m);
  }

  _detail(item){
    if(item?.is_season_group){this._seasonDetail(item);return}
    const old=this.shadowRoot.querySelector(".modalbg");if(old)old.remove();
    const m=document.createElement("div");m.className="modalbg";
    const title=item.title||item.parsed_title||item.filename||"Sans titre";
    const meta=this._metadata(item);
    const parsed=item.parsed_title&&item.parsed_title!==item.title
      ?`<div class="detail-row"><strong>Nom détecté</strong><span>${this._esc(item.parsed_title)}</span></div>`:"";
    const path=item.relative_path
      ?`<div class="detail-row"><strong>Fichier</strong><span>${this._esc(item.relative_path)}</span></div>`:"";
    const match=item.metadata_status==="matched"
      ?"JustWatch + IMDb"
      :item.metadata_status==="imdb_only"
      ?"IMDb uniquement"
      :"Non identifié";
    m.innerHTML=`<div class="modal">
      <button class="modal-close" aria-label="Fermer">×</button>
      <div class="modal-head">
        ${item.poster?`<img src="${this._esc(item.poster)}" alt="">`:""}
        <div><h2>${this._esc(title)}</h2><div class="modal-meta">${this._esc(meta)}</div></div>
      </div>
      <p>${this._esc(item.description||"Aucun synopsis disponible pour le moment.")}</p>
      <div class="details">
        <div class="detail-row"><strong>Identification</strong><span>${this._esc(match)}</span></div>
        ${parsed}${path}
      </div>
    </div>`;
    m.onclick=e=>{if(e.target===m)m.remove()};
    m.querySelector(".modal-close").onclick=()=>m.remove();
    this.shadowRoot.appendChild(m);
  }
  _bind(){
    this.shadowRoot.querySelector(".refresh")?.addEventListener("click",()=>this._refresh());
    this.shadowRoot.querySelectorAll("[data-category]").forEach(b=>b.addEventListener("click",()=>{
      this._category=b.dataset.category;this._render();
    }));
    const items=this._items();
    this.shadowRoot.querySelectorAll("[data-index]").forEach(b=>b.addEventListener("click",()=>{
      const i=items[Number(b.dataset.index)];if(i)this._detail(i);
    }));
  }
  _render(){
    if(!this.shadowRoot)return;
    const d=this._data;
    const cats=this._categories();
    const items=this._items();
    const total=d?.count||0;
    const enriched=d?.enriched_count||0;
    const progress=total?Math.round((enriched/total)*100):0;
    let body="";
    if(this._error)body=`<div class="state error">${this._esc(this._error)}</div>`;
    else if(!d&&this._loading)body='<div class="state">Lecture de la vidéothèque…</div>';
    else if(d&&!d.enabled)body='<div class="state">Streaming Local est désactivé dans la configuration de l’intégration.</div>';
    else if(d?.errors?.length&&!total)body=`<div class="state error">${d.errors.map(x=>this._esc(x)).join("<br>")}</div>`;
    else if(d&&total===0)body='<div class="state">Aucun fichier vidéo détecté.</div>';
    else body=`<div class="rail">${items.map((i,n)=>this._tile(i,n)).join("")}</div>`;

    const status=this._enriching
      ?`Identification des films… ${enriched}/${total}`
      :total
      ?`${total} fichier${total>1?"s":""} · métadonnées ${progress}%`
      :"";

    this.shadowRoot.innerHTML=`<style>
      :host{display:block}
      ha-card{overflow:hidden}
      .wrap{padding:16px}
      .top{display:flex;align-items:center;gap:10px;margin-bottom:12px}
      .title{font-size:1.25rem;font-weight:800}
      .status{font-size:.82rem;color:var(--secondary-text-color)}
      .spacer{flex:1}
      button{font:inherit;color:var(--primary-text-color)}
      .refresh{width:36px;height:36px;border:0;border-radius:50%;background:var(--secondary-background-color);cursor:pointer;font-size:20px}
      .tabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px}
      .tab{display:flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:8px 12px;background:var(--secondary-background-color);cursor:pointer;white-space:nowrap}
      .tab.active{background:var(--primary-color);color:var(--text-primary-color,#fff)}
      .tab ha-icon{--mdc-icon-size:18px}
      .rail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(145px,170px);gap:12px;overflow-x:auto;padding:2px 2px 10px;scroll-snap-type:x proximity}
      .media{display:block;min-width:0;padding:0;border:0;background:none;text-align:left;cursor:pointer;scroll-snap-align:start}
      .poster{position:relative;aspect-ratio:2/3;border-radius:12px;overflow:hidden;background:var(--secondary-background-color);box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .poster img{width:100%;height:100%;display:block;object-fit:cover}
      .poster-fallback{width:100%;height:100%;display:grid;place-items:center;color:var(--secondary-text-color)}
      .poster-fallback ha-icon{--mdc-icon-size:48px}
      .media-title{margin-top:8px;font-weight:800;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .media-meta{margin-top:4px;min-height:17px;color:var(--secondary-text-color);font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .series-extra{margin-top:3px;color:var(--secondary-text-color);font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .match{position:absolute;top:7px;left:7px;border-radius:999px;padding:4px 7px;background:rgba(0,0,0,.72);color:#fff;font-size:.68rem;font-weight:800}
      .match.imdb{background:rgba(155,110,0,.88)}.match.unmatched{background:rgba(130,35,35,.88)}.match.pending{background:rgba(30,30,30,.72)}
      .state{padding:28px 12px;text-align:center;color:var(--secondary-text-color)}
      .error{color:var(--error-color)}
      .modalbg{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
      .modal{position:relative;width:min(520px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:20px;border-radius:20px;background:var(--card-background-color)}
      .modal-close{position:absolute;right:10px;top:10px;width:38px;height:38px;border:0;border-radius:50%;background:var(--secondary-background-color);font-size:25px;cursor:pointer}
      .modal-head{display:flex;gap:14px;padding-right:42px;align-items:flex-start}
      .modal-head img{width:88px;aspect-ratio:2/3;object-fit:cover;border-radius:9px}
      .modal h2{margin:4px 0 6px;font-size:1.35rem}.modal-meta{color:var(--secondary-text-color)}.local-title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.local-title-row h2{margin-right:0}.age-badge{display:inline-grid;place-items:center;flex:0 0 auto;box-sizing:border-box;font-weight:900;line-height:1;vertical-align:middle}.age-badge.fr{width:29px;height:29px;border-radius:50%;background:#d9d9d9!important;color:#111!important;border:0!important;font-size:.66rem;box-shadow:none!important}.age-badge.us{min-width:42px;height:26px;padding:0 7px;border-radius:6px;background:#242424!important;color:#fff!important;border:0!important;font-size:.64rem;letter-spacing:.01em;box-shadow:none!important}
      .modal p{line-height:1.45;color:var(--secondary-text-color)}
      .details{display:grid;gap:7px;margin-top:14px}.detail-row{display:grid;grid-template-columns:110px 1fr;gap:10px;font-size:.88rem}.detail-row span{overflow-wrap:anywhere;color:var(--secondary-text-color)}
      .season-story-title{margin:0 0 6px;font-size:1.02rem;font-weight:700;color:var(--primary-text-color)}
      .series-summary{margin-top:6px;color:var(--secondary-text-color);font-size:.86rem}
      .season-tabs{display:flex;gap:8px;overflow-x:auto;margin:18px 0 12px;padding-bottom:2px}
      .season-tab{border:0;border-radius:999px;padding:8px 12px;background:var(--secondary-background-color);cursor:pointer;white-space:nowrap;font-weight:800}
      .season-tab.active{background:var(--primary-color);color:var(--text-primary-color,#fff)}
      .episode-list{display:grid;gap:7px}
      .episode-row{width:100%;display:flex;align-items:center;gap:10px;border:0;border-radius:12px;padding:10px 12px;background:var(--secondary-background-color);cursor:pointer;text-align:left}
      .episode-row.selected{outline:2px solid var(--primary-color)}
      .episode-main{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}
      .episode-main small{color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .episode-row ha-icon{flex:0 0 auto;color:var(--primary-color)}
      .episode-help{margin-top:12px;color:var(--secondary-text-color);font-size:.78rem;line-height:1.35}
      @media(max-width:600px){.wrap{padding:14px 11px}.rail{grid-auto-columns:minmax(140px,44vw)}.status{display:none}.modal{padding:15px}.modal-head img{width:74px}.detail-row{grid-template-columns:1fr;gap:2px}}
    </style>
    <ha-card><div class="wrap">
      <div class="top"><div><div class="title">${this._esc(this._config.title)}</div><div class="status">${this._esc(status)}</div></div><div class="spacer"></div><button class="refresh" title="Rescanner">${this._loading?"…":"↻"}</button></div>
      ${cats.length?`<div class="tabs category-tabs adaptive-tabs">${cats.map(cat=>`<button class="tab ${cat===this._category?"active":""}" data-category="${cat}"><ha-icon icon="${this._icon(cat)}"></ha-icon><span>${this._label(cat)} (${this._categoryCount(cat)})</span></button>`).join("")}</div>`:""}
      ${body}
    </div></ha-card>`;
    this._bind();
  }
}
// v0.9 Local family + watched views.
// This layer only changes StreamingLocalCard presentation/actions. Scanner,
// LocalMetadataClient and the historical Streaming/Top cards stay untouched.
StreamingLocalCard.prototype.connectedCallback=function(){
  if(this._statusSyncHandler)return;
  this._statusSyncHandler=e=>{
    if(e?.detail?.source===this)return;
    if(this._hass&&!this._loading)void this._load(false);
  };
  window.addEventListener("streaming-top-fr-status-changed",this._statusSyncHandler);
};
StreamingLocalCard.prototype.disconnectedCallback=function(){
  if(this._statusSyncHandler){
    window.removeEventListener("streaming-top-fr-status-changed",this._statusSyncHandler);
  }
  this._statusSyncHandler=null;
};
StreamingLocalCard.prototype._broadcastStatusChange=function(){
  window.dispatchEvent(new CustomEvent(
    "streaming-top-fr-status-changed",
    {detail:{source:this}}
  ));
};
StreamingLocalCard.prototype.setConfig=function(c){
  this._config={title:"Streaming Local",default_category:"movies",...c};
  if(!this.shadowRoot)this.attachShadow({mode:"open"});
  this._category=String(this._config.default_category||"movies");
  this._familyCategory="movies";
  this._watchFilter="all";
  this._seriesSelection={};
  this._data=null;this._loading=false;this._enriching=false;this._error=null;
  this._render();
};
StreamingLocalCard.prototype._categories=function(){
  const out=["movies","series","animation","documentaries"];
  if(this._data?.family?.enabled===true)out.push("family");
  return out;
};
StreamingLocalCard.prototype._label=function(cat){
  return{movies:"Films",series:"Séries",animation:"Animation",documentaries:"Documentaires",family:"Famille"}[cat]||cat;
};
StreamingLocalCard.prototype._icon=function(cat){
  return{movies:"mdi:filmstrip",series:"mdi:television-play",animation:"mdi:creation",documentaries:"mdi:earth",family:"mdi:account-group"}[cat]||"mdi:movie-open";
};
StreamingLocalCard.prototype._familyCategories=function(){
  const cfg=this._data?.family||{};
  return ["movies","series","animation"].filter(cat=>cfg[cat]!==false);
};
StreamingLocalCard.prototype._effectiveCategory=function(category=this._category,familyCategory=this._familyCategory){
  return category==="family"?familyCategory:category;
};
StreamingLocalCard.prototype._rawItems=function(category=this._category,familyCategory=this._familyCategory){
  const bucket=this._effectiveCategory(category,familyCategory);
  let items=(this._data?.items||[]).filter(i=>i.bucket===bucket);
  if(category==="family")items=items.filter(i=>i.family_eligible===true);
  return bucket==="movies"?this._sortMovieCollections(items):items;
};
StreamingLocalCard.prototype._episodicSeasonGroups=function(category,familyCategory=this._familyCategory){
  const raw=this._rawItems(category,familyCategory);
  const standalone=[];
  const groups=new Map();

  for(const item of raw){
    const episodic=item?.episodic===true||
      (item?.season!==null&&item?.season!==undefined&&
       item?.episode!==null&&item?.episode!==undefined);
    if(!episodic){
      standalone.push(item);
      continue;
    }

    const fallbackTitle=String(
      item.parsed_title||item.title||item.filename||""
    ).trim().toLocaleLowerCase("fr");
    const seriesKey=String(
      item.imdb_id||item.canonical_watch_key||item.canonical_media_key||
      `series:${this._effectiveCategory(category,familyCategory)}:${fallbackTitle}`
    ).trim();
    const season=Number(item.season??0);
    const seasonKey=`${seriesKey}:season:${season}`;
    if(!groups.has(seasonKey)){
      groups.set(seasonKey,{seriesKey,season,episodes:[]});
    }
    groups.get(seasonKey).episodes.push(item);
  }

  const seasons=[];
  for(const [seasonKey,group] of groups.entries()){
    const episodes=group.episodes;
    episodes.sort((a,b)=>
      Number(a.episode??0)-Number(b.episode??0)||
      String(a.relative_path||"").localeCompare(
        String(b.relative_path||""),"fr"
      )
    );
    const representative=
      episodes.find(i=>i.poster&&i.rating!=null)||
      episodes.find(i=>i.poster)||
      episodes.find(i=>i.metadata_status==="matched")||
      episodes[0];
    const franchiseTitle=String(
      representative.title||
      representative.franchise_title||
      representative.parsed_title||
      ""
    ).trim();
    const episodeTitles=[...new Set(
      episodes.map(ep=>String(ep.episode_title||"").trim()).filter(Boolean)
    )];
    const seasonTitle=episodeTitles.length===1?episodeTitles[0]:null;
    const watchedCount=episodes.filter(ep=>ep.watch_state===true).length;
    seasons.push({
      ...representative,
      is_season_group:true,
      series_key:group.seriesKey,
      season_key:seasonKey,
      franchise_title:franchiseTitle,
      season_title:seasonTitle,
      episodes,
      episode_count:episodes.length,
      watched_count:watchedCount,
      watch_state:episodes.length>0&&watchedCount===episodes.length,
      watch_partial:watchedCount>0&&watchedCount<episodes.length,
      season:group.season,
      episode:null,
      filename:null,
      relative_path:null,
      smb_uri:null,
    });
  }

  const combined=[...standalone,...seasons];
  return combined.sort((a,b)=>{
    const at=String(a.title||a.parsed_title||a.filename||"");
    const bt=String(b.title||b.parsed_title||b.filename||"");
    return at.localeCompare(bt,"fr")||
      Number(a.season??-1)-Number(b.season??-1);
  });
};
StreamingLocalCard.prototype._displayItems=function(category=this._category,familyCategory=this._familyCategory){
  const bucket=this._effectiveCategory(category,familyCategory);
  return ["series","animation","documentaries"].includes(bucket)
    ?this._episodicSeasonGroups(category,familyCategory)
    :this._rawItems(category,familyCategory);
};
StreamingLocalCard.prototype._filteredItems=function(category=this._category,familyCategory=this._familyCategory){
  const items=this._displayItems(category,familyCategory);
  if(this._watchFilter==="watched")return items.filter(i=>i.watch_state===true);
  if(this._watchFilter==="unwatched")return items.filter(i=>i.watch_state!==true);
  return items;
};
StreamingLocalCard.prototype._items=function(){return this._filteredItems()};
StreamingLocalCard.prototype._categoryCount=function(cat){
  if(cat==="family"){
    return this._familyCategories().reduce(
      (sum,fcat)=>sum+this._displayItems("family",fcat).length,0
    );
  }
  return this._displayItems(cat).length;
};
StreamingLocalCard.prototype._watchCounts=function(){
  const all=this._displayItems();
  const watched=all.filter(i=>i.watch_state===true).length;
  return{all:all.length,watched,unwatched:all.length-watched};
};
StreamingLocalCard.prototype._normalizeCategory=function(){
  const cats=this._categories();
  if(cats.length&&!cats.includes(this._category))this._category=cats[0];
  const familyCats=this._familyCategories();
  if(this._category==="family"&&familyCats.length&&!familyCats.includes(this._familyCategory)){
    this._familyCategory=familyCats[0];
  }
  if(!["all","unwatched","watched"].includes(this._watchFilter))this._watchFilter="all";
};
StreamingLocalCard.prototype._tile=function(item,index){
  const poster=item.poster
    ?`<img src="${this._esc(item.poster)}" alt="${this._esc(item.title||item.filename||"")}" loading="lazy">`
    :'<div class="poster-fallback"><ha-icon icon="mdi:movie-open-outline"></ha-icon></div>';
  const meta=this._metadata(item);
  const title=item.title||item.parsed_title||item.filename||"Sans titre";
  const watchedBadge=item.watch_state===true
    ?'<span class="watched-badge"><ha-icon icon="mdi:check"></ha-icon> Vu</span>'
    :item.watch_partial
    ?`<span class="watched-badge partial">${item.watched_count}/${item.episode_count}</span>`
    :"";
  const seriesExtra=item.is_season_group
    ?`Saison ${item.season??"?"} · ${item.episode_count} épisode${item.episode_count>1?"s":""} · ${item.watched_count||0}/${item.episode_count} vus`
    :"";
  return `<button class="media" data-index="${index}" title="${this._esc(item.filename||title)}">
    <div class="poster">${poster}${this._status(item)}${watchedBadge}</div>
    <div class="media-title">${this._esc(title)}</div>
    <div class="media-meta">${this._esc(meta)}</div>
    ${seriesExtra?`<div class="series-extra">${this._esc(seriesExtra)}</div>`:""}
  </button>`;
};
StreamingLocalCard.prototype._setWatch=async function(items,enabled){
  if(!this._hass||!Array.isArray(items)||!items.length)return;
  try{
    await this._hass.callWS({
      type:"streaming_top_fr/set_local_watch_status",
      items:items.map(item=>({
        media_key:item.media_key,
        local_id:item.local_id,
        canonical_media_key:item.canonical_media_key,
        imdb_id:item.imdb_id,
        media_type:item.media_type,
        title:item.title,
        original_title:item.original_title,
        parsed_title:item.parsed_title,
        franchise_title:item.franchise_title,
        year:item.year,
        episodic:item.episodic,
        season:item.season,
        episode:item.episode,
      })),
      enabled:Boolean(enabled),
    });
    await this._load(false);
    this._broadcastStatusChange();
  }catch(e){
    this._error=String(e);
    this._render();
  }
};
StreamingLocalCard.prototype._localAge=function(item){
  const fr=item?.age_fr||(String(item?.age_country||"").toUpperCase()==="FR"?item?.age_certification:null);
  const us=item?.age_us||(String(item?.age_country||"").toUpperCase()==="US"?item?.age_certification:null);
  if(fr)return{value:fr,country:"FR"};
  if(us)return{value:us,country:"US"};
  const value=item?.age_certification||null;
  const country=String(item?.age_country||"").toUpperCase()||null;
  return{value,country};
};
StreamingLocalCard.prototype._localAgeBadge=function(item){
  const age=this._localAge(item);
  const v=String(age.value||"").trim().toUpperCase();
  const country=String(age.country||"").trim().toUpperCase();
  if(!v)return"";
  if(country==="FR")return `<span class="age-badge fr" title="Classification France ${this._esc(v)}">${this._esc(v)}</span>`;
  if(country==="US")return `<span class="age-badge us" title="Classification US ${this._esc(v)}">${this._esc(v)}</span>`;
  return `<span class="age-badge us">${this._esc(v)}</span>`;
};
StreamingLocalCard.prototype._localPlayback=function(){
  return this._data?.local_playback||{enabled:false,players:[]};
};
StreamingLocalCard.prototype._vlcControls=function(item,label=""){
  const cfg=this._localPlayback();
  const players=Array.isArray(cfg.players)?cfg.players:[];
  if(cfg.enabled!==true||!item?.local_id||!players.length){
    if(cfg.enabled===true&&item?.local_id&&!players.length){
      console.warn("[Streaming Top FR]",STFR_VERSION,"VLC activé mais aucune destination compatible n\'a été reçue.");
    }
    return"";
  }
  const episodeSuffix=label?` · ${this._esc(label)}`:"";
  const buttons=players.map(player=>`<button class="vlc-destination" data-local-play-player="${this._esc(player.id)}"><ha-icon icon="mdi:vlc"></ha-icon><span class="vlc-copy"><strong>Voir avec VLC${episodeSuffix}</strong><small>sur ${this._esc(player.name||player.id)}</small></span></button>`).join("");
  return `<div class="vlc-row">${buttons}</div>`;
};
StreamingLocalCard.prototype._playLocal=async function(item,playerId,button){
  if(!this._hass||!item?.local_id||!playerId)return;
  const oldHtml=button?.innerHTML;
  if(button){
    button.disabled=true;
    button.innerHTML='<ha-icon icon="mdi:loading"></ha-icon><span>Lancement…</span>';
  }
  try{
    await this._hass.callWS({
      type:"streaming_top_fr/play_local",
      local_id:item.local_id,
      player:playerId,
    });
    if(button){
      button.innerHTML='<ha-icon icon="mdi:check"></ha-icon><span>Lancé</span>';
      setTimeout(()=>{
        if(button?.isConnected){
          button.disabled=false;
          button.innerHTML=oldHtml;
        }
      },1800);
    }
  }catch(e){
    if(button){
      button.disabled=false;
      button.innerHTML=oldHtml;
    }
    this._error=`VLC : ${String(e)}`;
    this._render();
  }
};
StreamingLocalCard.prototype._seasonDetail=function(item){
  const old=this.shadowRoot.querySelector(".modalbg");if(old)old.remove();
  const episodes=[...(item.episodes||[])].sort((a,b)=>
    Number(a.episode??0)-Number(b.episode??0)||
    String(a.relative_path||"").localeCompare(String(b.relative_path||""),"fr")
  );
  const selectionKey=item.season_key||`${item.series_key||"series"}:season:${item.season??0}`;
  const defaultEpisode=episodes.find(ep=>ep.watch_state!==true)||episodes[0]||null;
  const selectedId=this._seriesSelection?.[selectionKey]||defaultEpisode?.local_id||null;
  const selectedEpisode=episodes.find(ep=>ep.local_id===selectedId)||defaultEpisode;
  if(selectedEpisode){
    this._seriesSelection=this._seriesSelection||{};
    this._seriesSelection[selectionKey]=selectedEpisode.local_id;
  }
  const m=document.createElement("div");m.className="modalbg";
  const franchise=item.franchise_title||item.title||item.parsed_title||"Sans titre";
  const storyTitle=item.season_title||"";
  const metaParts=[];
  if(item.year)metaParts.push(String(item.year));
  if(item.rating!=null){const n=Number(item.rating);metaParts.push(`★ ${Number.isFinite(n)?n.toFixed(1):this._esc(item.rating)}`)}
  const meta=metaParts.join(" · ");
  const ageBadge=this._localAgeBadge(item);
  const match=item.metadata_status==="matched"
    ?"JustWatch + IMDb"
    :item.metadata_status==="imdb_only"
    ?"IMDb uniquement"
    :"Non identifié";
  const episodeRows=episodes.map((ep,index)=>{
    const epNo=ep.episode!=null?Number(ep.episode):index+1;
    const code=ep.season!=null&&ep.episode!=null
      ?`S${String(ep.season).padStart(2,"0")}E${String(ep.episode).padStart(2,"0")}`
      :`Épisode ${epNo}`;
    const selected=selectedId&&selectedId===ep.local_id;
    const displayTitle=ep.episode_title||storyTitle||`Épisode ${epNo}`;
    const seen=ep.watch_state===true;
    return `<div class="episode-row ${selected?"selected":""}">
      <button class="episode-select" data-episode-index="${index}">
        <span class="episode-main"><strong>${this._esc(code)}</strong><small>${this._esc(displayTitle)}</small></span>
        <ha-icon icon="${selected?"mdi:play-circle":"mdi:play-circle-outline"}"></ha-icon>
      </button>
      <button class="episode-watch ${seen?"on":""}" data-episode-watch-index="${index}" title="${seen?"Remettre dans Pas encore vus":"Marquer vu"}">
        <ha-icon icon="${seen?"mdi:check-circle":"mdi:check-circle-outline"}"></ha-icon>
      </button>
    </div>`;
  }).join("");
  const allSeen=episodes.length>0&&episodes.every(ep=>ep.watch_state===true);
  const selectedCode=selectedEpisode&&selectedEpisode.season!=null&&selectedEpisode.episode!=null
    ?`S${String(selectedEpisode.season).padStart(2,"0")}E${String(selectedEpisode.episode).padStart(2,"0")}`
    :"";
  const vlcControls=this._vlcControls(selectedEpisode,selectedCode);
  m.innerHTML=`<div class="modal series-modal">
    <button class="modal-close" aria-label="Fermer">×</button>
    <div class="modal-head">
      ${item.poster?`<img src="${this._esc(item.poster)}" alt="">`:""}
      <div>
        <h2>${this._esc(franchise)}</h2>
        ${storyTitle?`<div class="season-story-title">${this._esc(storyTitle)}</div>`:""}
        <div class="modal-meta">${this._esc(meta)}</div>
        <div class="series-summary">Saison ${this._esc(item.season??"?")} · ${item.episode_count} épisode${item.episode_count>1?"s":""} · ${item.watched_count||0}/${item.episode_count} vus</div>
      </div>
    </div>
    <p>${this._esc(item.description||"Aucun synopsis disponible pour le moment.")}</p>
    <div class="details">
      <div class="detail-row"><strong>Identification</strong><span>${this._esc(match)}</span></div>
    </div>
    ${vlcControls}
    <div class="watch-actions"><button class="watch-main" data-season-watch="${allSeen?"false":"true"}"><ha-icon icon="${allSeen?"mdi:eye-off-outline":"mdi:check-all"}"></ha-icon>${allSeen?"Remettre la saison dans Pas encore vus":"Marquer toute la saison vue"}</button></div>
    <div class="episode-list">${episodeRows||'<div class="state">Aucun épisode détecté pour cette saison.</div>'}</div>
    <div class="episode-help">Le statut Vu est partagé avec les services de streaming au niveau de l’œuvre. Un épisode peut toutefois être remis explicitement en non vu.</div>
  </div>`;
  m.onclick=e=>{if(e.target===m)m.remove()};
  m.querySelector(".modal-close").onclick=()=>m.remove();
  m.querySelectorAll("[data-local-play-player]").forEach(b=>b.addEventListener("click",async e=>{
    e.stopPropagation();
    if(selectedEpisode)await this._playLocal(selectedEpisode,b.dataset.localPlayPlayer,b);
  }));
  m.querySelector("[data-season-watch]")?.addEventListener("click",async e=>{
    const enabled=e.currentTarget.dataset.seasonWatch==="true";
    m.remove();
    await this._setWatch(episodes,enabled);
  });
  m.querySelectorAll("[data-episode-index]").forEach(b=>b.addEventListener("click",()=>{
    const ep=episodes[Number(b.dataset.episodeIndex)];
    if(!ep)return;
    this._seriesSelection=this._seriesSelection||{};
    this._seriesSelection[selectionKey]=ep.local_id;
    this._seasonDetail(item);
  }));
  m.querySelectorAll("[data-episode-watch-index]").forEach(b=>b.addEventListener("click",async e=>{
    e.stopPropagation();
    const ep=episodes[Number(b.dataset.episodeWatchIndex)];
    if(!ep)return;
    m.remove();
    await this._setWatch([ep],ep.watch_state!==true);
  }));
  this.shadowRoot.appendChild(m);
};
StreamingLocalCard.prototype._detail=function(item){
  if(item?.is_season_group){this._seasonDetail(item);return}
  const old=this.shadowRoot.querySelector(".modalbg");if(old)old.remove();
  const m=document.createElement("div");m.className="modalbg";
  const title=item.title||item.parsed_title||item.filename||"Sans titre";
  const metaParts=[];
  if(item.year)metaParts.push(String(item.year));
  if(item.rating!=null){const n=Number(item.rating);metaParts.push(`★ ${Number.isFinite(n)?n.toFixed(1):this._esc(item.rating)}`)}
  const meta=metaParts.join(" · ");
  const ageBadge=this._localAgeBadge(item);
  const parsed=item.parsed_title&&item.parsed_title!==item.title
    ?`<div class="detail-row"><strong>Nom détecté</strong><span>${this._esc(item.parsed_title)}</span></div>`:"";
  const path=item.relative_path
    ?`<div class="detail-row"><strong>Fichier</strong><span>${this._esc(item.relative_path)}</span></div>`:"";
  const match=item.metadata_status==="matched"
    ?"JustWatch + IMDb"
    :item.metadata_status==="imdb_only"
    ?"IMDb uniquement"
    :"Non identifié";
  const seen=item.watch_state===true;
  const vlcControls=this._vlcControls(item);
  m.innerHTML=`<div class="modal">
    <button class="modal-close" aria-label="Fermer">×</button>
    <div class="modal-head">
      ${item.poster?`<img src="${this._esc(item.poster)}" alt="">`:""}
      <div class="modal-head-copy"><div class="local-title-row"><h2>${this._esc(title)}</h2>${ageBadge}</div><div class="modal-meta">${this._esc(meta)}</div></div>
    </div>
    <p>${this._esc(item.description||"Aucun synopsis disponible pour le moment.")}</p>
    <details class="technical-details">
      <summary>Détails techniques</summary>
      <div class="details">
        <div class="detail-row"><strong>Identification</strong><span>${this._esc(match)}</span></div>
        ${parsed}${path}
      </div>
    </details>
    ${vlcControls}
    <div class="watch-actions"><button class="watch-main" data-item-watch="${seen?"false":"true"}"><ha-icon icon="${seen?"mdi:eye-off-outline":"mdi:check-circle-outline"}"></ha-icon>${seen?"Remettre dans Pas encore vus":"Marquer vu"}</button></div>
  </div>`;
  m.onclick=e=>{if(e.target===m)m.remove()};
  m.querySelector(".modal-close").onclick=()=>m.remove();
  m.querySelectorAll("[data-local-play-player]").forEach(b=>b.addEventListener("click",async e=>{
    e.stopPropagation();
    await this._playLocal(item,b.dataset.localPlayPlayer,b);
  }));
  m.querySelector("[data-item-watch]")?.addEventListener("click",async e=>{
    const enabled=e.currentTarget.dataset.itemWatch==="true";
    m.remove();
    await this._setWatch([item],enabled);
  });
  this.shadowRoot.appendChild(m);
};
StreamingLocalCard.prototype._bind=function(){
  this.shadowRoot.querySelector(".refresh")?.addEventListener("click",()=>this._refresh());
  this.shadowRoot.querySelectorAll("[data-category]").forEach(b=>b.addEventListener("click",()=>{
    this._category=b.dataset.category;
    this._normalizeCategory();
    this._render();
  }));
  this.shadowRoot.querySelectorAll("[data-family-category]").forEach(b=>b.addEventListener("click",()=>{
    this._familyCategory=b.dataset.familyCategory;
    this._render();
  }));
  this.shadowRoot.querySelectorAll("[data-watch-filter]").forEach(b=>b.addEventListener("click",()=>{
    this._watchFilter=b.dataset.watchFilter;
    this._render();
  }));
  const items=this._items();
  this.shadowRoot.querySelectorAll("[data-index]").forEach(b=>b.addEventListener("click",()=>{
    const i=items[Number(b.dataset.index)];if(i)this._detail(i);
  }));
};
StreamingLocalCard.prototype._render=function(){
  if(!this.shadowRoot)return;
  const d=this._data;
  this._normalizeCategory();
  const cats=this._categories();
  const items=this._items();
  const total=d?.count||0;
  const enriched=d?.enriched_count||0;
  const progress=total?Math.round((enriched/total)*100):0;
  const watchCounts=this._watchCounts();
  const familyCats=this._familyCategories();
  let body="";
  if(this._error)body=`<div class="state error">${this._esc(this._error)}</div>`;
  else if(!d&&this._loading)body='<div class="state">Lecture de la vidéothèque…</div>';
  else if(d&&!d.enabled)body='<div class="state">Streaming Local est désactivé dans la configuration de l’intégration.</div>';
  else if(d?.errors?.length&&!total)body=`<div class="state error">${d.errors.map(x=>this._esc(x)).join("<br>")}</div>`;
  else if(d&&total===0)body='<div class="state">Aucun fichier vidéo détecté.</div>';
  else if(items.length)body=`<div class="rail">${items.map((i,n)=>this._tile(i,n)).join("")}</div>`;
  else body=`<div class="state">${this._watchFilter==="watched"?"Aucun élément vu dans cette rubrique.":this._watchFilter==="unwatched"?"Tout ce qui est présent ici a déjà été vu.":"Aucun élément dans cette rubrique."}</div>`;

  const status=this._enriching
    ?`Identification des films… ${enriched}/${total}`
    :total
    ?`${total} fichier${total>1?"s":""} · métadonnées ${progress}%`
    :"";

  const familyRow=this._category==="family"
    ?`<div class="subtabs family-tabs adaptive-tabs">${familyCats.map(cat=>`<button class="subtab ${cat===this._familyCategory?"active":""}" data-family-category="${cat}"><ha-icon icon="${this._icon(cat)}"></ha-icon><span>${this._label(cat)} (${this._displayItems("family",cat).length})</span></button>`).join("")}</div>`
    :'<div class="subtabs family-tabs reserved" aria-hidden="true"></div>';

  const watchRow=`<div class="subtabs watch-tabs adaptive-tabs">
    <button class="subtab ${this._watchFilter==="all"?"active":""}" data-watch-filter="all">Tous (${watchCounts.all})</button>
    <button class="subtab ${this._watchFilter==="unwatched"?"active":""}" data-watch-filter="unwatched">Pas encore vus (${watchCounts.unwatched})</button>
    <button class="subtab ${this._watchFilter==="watched"?"active":""}" data-watch-filter="watched">Vus (${watchCounts.watched})</button>
  </div>`;

  this.shadowRoot.innerHTML=`<style>
    :host{display:block}
    ha-card{overflow:hidden}
    .wrap{padding:16px}
    .top{display:flex;align-items:center;gap:10px;margin-bottom:12px}
    .title{font-size:1.25rem;font-weight:800}
    .status{font-size:.82rem;color:var(--secondary-text-color)}
    .spacer{flex:1}
    button{font:inherit;color:var(--primary-text-color)}
    .refresh{width:36px;height:36px;border:0;border-radius:50%;background:var(--secondary-background-color);cursor:pointer;font-size:20px}
    .tabs,.subtabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
    .tabs{margin-bottom:8px}
    .adaptive-tabs{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:10px 14px;overflow:visible;margin-left:auto;margin-right:auto}.category-groups{display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:8px}.category-row{display:flex;justify-content:center;align-items:center;gap:14px;overflow:visible;padding:0;margin:0}.family-tabs,.watch-tabs{justify-content:center}
    .subtabs{min-height:36px;margin-bottom:8px}
    .subtabs.reserved{visibility:hidden}
    .tab,.subtab{display:flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:8px 12px;background:var(--secondary-background-color);cursor:pointer;white-space:nowrap}
    .category-row .tab{justify-content:center;font-weight:800}
    .subtab{padding:7px 11px;font-size:.86rem}
    .tab.active,.subtab.active{background:var(--primary-color);color:var(--text-primary-color,#fff)}
    .tab ha-icon,.subtab ha-icon{--mdc-icon-size:18px}
    .rail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(145px,170px);gap:12px;overflow-x:auto;padding:2px 2px 10px;scroll-snap-type:x proximity}
    .media{display:block;min-width:0;padding:0;border:0;background:none;text-align:left;cursor:pointer;scroll-snap-align:start}
    .poster{position:relative;aspect-ratio:2/3;border-radius:12px;overflow:hidden;background:var(--secondary-background-color);box-shadow:0 2px 8px rgba(0,0,0,.18)}
    .poster img{width:100%;height:100%;display:block;object-fit:cover}
    .poster-fallback{width:100%;height:100%;display:grid;place-items:center;color:var(--secondary-text-color)}
    .poster-fallback ha-icon{--mdc-icon-size:48px}
    .media-title{margin-top:8px;font-weight:800;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .media-meta{margin-top:4px;min-height:17px;color:var(--secondary-text-color);font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .series-extra{margin-top:3px;color:var(--secondary-text-color);font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .match{position:absolute;top:7px;left:7px;border-radius:999px;padding:4px 7px;background:rgba(0,0,0,.72);color:#fff;font-size:.68rem;font-weight:800}
    .match.imdb{background:rgba(155,110,0,.88)}.match.unmatched{background:rgba(130,35,35,.88)}.match.pending{background:rgba(30,30,30,.72)}
    .watched-badge{position:absolute;top:7px;right:7px;display:flex;align-items:center;gap:3px;border-radius:999px;padding:4px 7px;background:var(--primary-color);color:var(--text-primary-color,#fff);font-size:.68rem;font-weight:800}
    .watched-badge.partial{background:rgba(0,0,0,.72);color:#fff}.watched-badge ha-icon{--mdc-icon-size:13px}
    .state{padding:28px 12px;text-align:center;color:var(--secondary-text-color)}
    .error{color:var(--error-color)}
    .modalbg{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
    .modal{position:relative;width:min(520px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:20px;border-radius:20px;background:var(--card-background-color)}
    .modal-close{position:absolute;right:10px;top:10px;width:38px;height:38px;border:0;border-radius:50%;background:var(--secondary-background-color);font-size:25px;cursor:pointer}
    .modal-head{display:flex;gap:14px;padding-right:42px;align-items:flex-start}
    .modal-head img{width:88px;aspect-ratio:2/3;object-fit:cover;border-radius:9px}
    .modal h2{margin:4px 0 6px;font-size:1.35rem}.modal-meta{color:var(--secondary-text-color)}.local-title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.age-badge{display:inline-grid;place-items:center;flex:0 0 auto;box-sizing:border-box;font-weight:900;line-height:1;vertical-align:middle}.age-badge.fr{width:29px;height:29px;border-radius:50%;background:#d9d9d9!important;color:#111!important;border:0!important;font-size:.66rem;box-shadow:none!important}.age-badge.us{min-width:42px;height:26px;padding:0 7px;border-radius:6px;background:#242424!important;color:#fff!important;border:0!important;font-size:.64rem;letter-spacing:.01em;box-shadow:none!important}
    .modal p{line-height:1.45;color:var(--secondary-text-color)}
    .technical-details{margin:14px 0 4px;border-top:1px solid var(--divider-color);border-bottom:1px solid var(--divider-color)}.technical-details summary{padding:10px 2px;cursor:pointer;font-size:.88rem;font-weight:800;color:var(--secondary-text-color);list-style-position:inside}.technical-details[open] summary{color:var(--primary-text-color)}.technical-details .details{margin:0;padding:2px 2px 12px}
    .details{display:grid;gap:7px;margin-top:14px}.detail-row{display:grid;grid-template-columns:110px 1fr;gap:10px;font-size:.88rem}.detail-row span{overflow-wrap:anywhere;color:var(--secondary-text-color)}
    .season-story-title{margin:0 0 6px;font-size:1.02rem;font-weight:700;color:var(--primary-text-color)}
    .series-summary{margin-top:6px;color:var(--secondary-text-color);font-size:.86rem}
    .watch-actions{display:flex;justify-content:center;margin:16px 0 12px}.watch-main{display:flex;align-items:center;gap:7px;border:0;border-radius:999px;padding:9px 13px;background:var(--secondary-background-color);color:var(--primary-text-color);cursor:pointer;font-weight:800}.watch-main ha-icon{--mdc-icon-size:18px}
    .vlc-row{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin:16px 0 10px}.vlc-destination{min-width:180px;min-height:82px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:1px solid rgba(222,86,44,.58);border-radius:999px;padding:10px 18px;background:linear-gradient(rgba(196,72,31,.32),rgba(91,34,22,.42)),rgba(20,16,14,.82);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(8px);cursor:pointer;font-weight:800;text-align:center}.vlc-destination:hover{filter:brightness(1.08)}.vlc-destination:disabled{opacity:.45;cursor:wait}.vlc-destination ha-icon{--mdc-icon-size:28px;color:#fff}.vlc-copy{display:flex;flex-direction:column;align-items:center;line-height:1.08}.vlc-copy strong{font-size:.88rem;color:#fff}.vlc-copy small{margin-top:5px;font-size:.92rem;font-weight:900;color:#fff}
    .episode-list{display:grid;gap:7px}
    .episode-row{width:100%;display:flex;align-items:stretch;gap:6px;border-radius:12px;background:var(--secondary-background-color)}
    .episode-row.selected{outline:2px solid var(--primary-color)}
    .episode-select{min-width:0;flex:1;display:flex;align-items:center;gap:10px;border:0;background:none;padding:10px 12px;cursor:pointer;text-align:left}
    .episode-main{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}
    .episode-main small{color:var(--secondary-text-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .episode-select ha-icon{flex:0 0 auto;color:var(--primary-color)}
    .episode-watch{flex:0 0 44px;border:0;border-left:1px solid var(--divider-color);background:none;cursor:pointer}.episode-watch ha-icon{--mdc-icon-size:22px;color:var(--secondary-text-color)}.episode-watch.on ha-icon{color:var(--primary-color)}
    .episode-help{margin-top:12px;color:var(--secondary-text-color);font-size:.78rem;line-height:1.35}
    @media(max-width:600px){.wrap{padding:14px 11px}.adaptive-tabs{gap:8px}.category-row{gap:8px;flex-wrap:wrap}.category-row .tab{justify-content:center}.rail{grid-auto-columns:minmax(140px,44vw)}.status{display:none}.modal{padding:15px}.modal-head img{width:74px}.detail-row{grid-template-columns:1fr;gap:2px}.tab,.subtab{padding-left:10px;padding-right:10px}}
  </style>
  <ha-card><div class="wrap">
    <div class="top"><div><div class="title">${this._esc(this._config.title)}</div><div class="status">${this._esc(status)}</div></div><div class="spacer"></div><button class="refresh" title="Rescanner">${this._loading?"…":"↻"}</button></div>
    ${cats.length?`<div class="category-groups"><div class="tabs category-row">${cats.slice(0,3).map(cat=>`<button class="tab ${cat===this._category?"active":""}" data-category="${cat}"><ha-icon icon="${this._icon(cat)}"></ha-icon><span>${this._label(cat)} (${this._categoryCount(cat)})</span></button>`).join("")}</div><div class="tabs category-row">${cats.slice(3).map(cat=>`<button class="tab ${cat===this._category?"active":""}" data-category="${cat}"><ha-icon icon="${this._icon(cat)}"></ha-icon><span>${this._label(cat)} (${this._categoryCount(cat)})</span></button>`).join("")}</div></div>`:""}
    ${familyRow}
    ${watchRow}
    ${body}
  </div></ha-card>`;
  this._bind();
};

customElements.define("streaming-local-card",StreamingLocalCard);

window.customCards=window.customCards||[];
window.customCards.push({type:'streaming-top-fr-card',name:'Streaming Top FR',description:'Streaming multi-services France via Netflix officiel + JustWatch'});
window.customCards.push({type:'streaming-top-fr-catalog-card',name:'Top Streaming FR',description:'Classements par décennie Films / Animation / Séries / Famille disponibles sur vos services'});
window.customCards.push({type:'streaming-local-card',name:'Streaming Local',description:'Vidéothèque locale Films / Séries / Animation / Documentaires avec métadonnées IMDb / JustWatch'});
console.info(`STREAMING TOP FR ${STFR_VERSION}`);


// ---------------------------------------------------------------------------
// Optional movie runtime filter (v1.0.4)
// Added as prototype decorators so the validated Streaming/Top class bodies
// remain unchanged. Runtime lookups are on-demand and isolated from catalogue
// construction and Streaming Local scanning.
// ---------------------------------------------------------------------------
function stfrDurationLabel(minutes){
  const value=Math.max(1,Number(minutes)||120);
  const hours=Math.floor(value/60);
  const mins=value%60;
  if(hours&&mins)return `${hours} h ${String(mins).padStart(2,"0")}`;
  if(hours)return `${hours} h`;
  return `${mins} min`;
}
function stfrDurationKey(item){
  return String(item?.local_id||item?.media_key||item?.canonical_media_key||"").trim();
}
function stfrDurationValue(card,item){
  const direct=Number(item?.runtime);
  if(Number.isFinite(direct)&&direct>0)return direct;
  const key=stfrDurationKey(item);
  const cached=Number(card?._durationRuntimeMap?.[key]);
  return Number.isFinite(cached)&&cached>0?cached:null;
}
function stfrDurationPayload(item){
  return {
    runtime_key:stfrDurationKey(item),
    media_type:item?.media_type||"movie",
    media_key:item?.media_key||null,
    local_id:item?.local_id||null,
    canonical_media_key:item?.canonical_media_key||null,
    imdb_id:item?.imdb_id||null,
    title:item?.title||null,
    original_title:item?.original_title||null,
    parsed_title:item?.parsed_title||null,
    year:item?.year??null,
    runtime:item?.runtime??null,
  };
}
async function stfrEnsureDurationRuntimes(card,items){
  if(!card?._hass)return;
  card._durationRuntimeMap=card._durationRuntimeMap||{};
  card._durationAttempted=card._durationAttempted||new Set();
  const unique=new Map();
  for(const item of items||[]){
    const key=stfrDurationKey(item);
    if(!key)continue;
    const direct=Number(item?.runtime);
    if(Number.isFinite(direct)&&direct>0){
      card._durationRuntimeMap[key]=direct;
      continue;
    }
    if(card._durationRuntimeMap[key]!=null||card._durationAttempted.has(key))continue;
    unique.set(key,item);
  }
  const pending=[...unique.values()];
  if(!pending.length)return;

  pending.forEach(item=>card._durationAttempted.add(stfrDurationKey(item)));
  card._durationLoading=true;
  card._durationError=null;
  card._render();

  try{
    for(let start=0;start<pending.length;start+=60){
      const chunk=pending.slice(start,start+60);
      const result=await card._hass.callWS({
        type:"streaming_top_fr/get_runtimes",
        items:chunk.map(stfrDurationPayload),
      });
      const runtimes=result?.runtimes||{};
      Object.entries(runtimes).forEach(([key,value])=>{
        const minutes=Number(value);
        if(Number.isFinite(minutes)&&minutes>0)card._durationRuntimeMap[key]=minutes;
      });
    }
  }catch(e){
    card._durationError=String(e?.message||e);
  }finally{
    card._durationLoading=false;
    card._render();
  }
}
function stfrDurationPass(card,item){
  const threshold=Number(card?._durationConfig?.()?.max_minutes??120);
  const runtime=stfrDurationValue(card,item);
  return runtime!==null&&runtime<threshold;
}
function stfrDurationButton(card,className="tab"){
  const cfg=card._durationConfig();
  const button=document.createElement("button");
  button.className=`${className} duration-filter-toggle ${card._durationFilterActive?"active":""}`;
  button.type="button";
  const label=stfrDurationLabel(cfg.max_minutes??120);
  button.innerHTML=card._durationLoading
    ?'<ha-icon icon="mdi:loading"></ha-icon><span>Durée…</span>'
    :`<ha-icon icon="mdi:timer-outline"></ha-icon><span>&lt; ${card._esc(label)}</span>`;
  button.title=card._durationFilterActive
    ?`Afficher tous les films (filtre actuel : moins de ${label})`
    :`Afficher uniquement les films de moins de ${label}`;
  button.addEventListener("click",async event=>{
    event.stopPropagation();
    if(card._durationFilterActive){
      card._durationFilterActive=false;
      card._render();
      return;
    }
    card._durationFilterActive=true;
    card._render();
    await stfrEnsureDurationRuntimes(card,card._durationCandidates());
  });
  return button;
}
function stfrMaybeLoadDuration(card){
  if(!card._durationFilterActive||card._durationLoading)return;
  const items=card._durationCandidates();
  const missing=(items||[]).some(item=>{
    const direct=Number(item?.runtime);
    const key=stfrDurationKey(item);
    return key&&!(Number.isFinite(direct)&&direct>0)&&
      card._durationRuntimeMap?.[key]==null&&!card._durationAttempted?.has(key);
  });
  if(missing)void stfrEnsureDurationRuntimes(card,items);
}

StreamingTopFrCard.prototype._durationConfig=function(){
  const cfg=this._data?.settings?.duration_filter||{};
  return{
    enabled:cfg.enabled!==false,
    max_minutes:Number(cfg.max_minutes||120),
  };
};
StreamingTopFrCard.prototype._durationMovieView=function(){
  return this._media==="movies";
};
StreamingTopFrCard.prototype._durationCandidates=function(){
  if(!this._durationMovieView())return[];
  if(this._section==="discover")return[...(this._pd()?.movies||[])];
  const bucket={
    watched:"watched",
    watchlist:"watchlist",
    not_interested:"not_interested",
  }[this._section];
  return bucket?this._stored(bucket):[];
};

const _stfrItemsBeforeDurationFilter=StreamingTopFrCard.prototype._items;
StreamingTopFrCard.prototype._items=function(){
  if(
    !this._durationConfig().enabled||
    !this._durationFilterActive||
    this._durationLoading||
    !this._durationMovieView()
  )return _stfrItemsBeforeDurationFilter.call(this);

  if(this._section==="discover"){
    const watched=this._watched(),hidden=this._notInterested();
    const all=(this._pd()?.movies||[]).filter(
      item=>!watched.has(item.media_key)&&!hidden.has(item.media_key)
    );
    const configured=Number(this._data?.settings?.discovery?.visible_count??10);
    const visible=Number.isFinite(configured)?Math.max(1,Math.floor(configured)):10;
    return all.filter(item=>stfrDurationPass(this,item)).slice(0,visible);
  }
  return _stfrItemsBeforeDurationFilter.call(this).filter(
    item=>stfrDurationPass(this,item)
  );
};

const _stfrRenderBeforeDurationFilter=StreamingTopFrCard.prototype._render;
StreamingTopFrCard.prototype._render=function(){
  const result=_stfrRenderBeforeDurationFilter.call(this);
  if(this._durationConfig().enabled&&this._durationMovieView()){
    const row=this.shadowRoot?.querySelector(".media-tabs");
    if(row&&!row.querySelector(".duration-filter-toggle")){
      row.appendChild(stfrDurationButton(this,"tab media-tab"));
    }
    stfrMaybeLoadDuration(this);
  }
  return result;
};

StreamingTopFrCatalogCard.prototype._durationMovieView=function(){
  return this._category==="movies";
};
StreamingTopFrCatalogCard.prototype._durationCandidates=function(){
  return this._durationMovieView()
    ?[...(this._catalogBranch()?.items||[])]
    :[];
};
const _stfrCatalogItemsBeforeDurationFilter=StreamingTopFrCatalogCard.prototype._catalogItems;
StreamingTopFrCatalogCard.prototype._catalogItems=function(){
  const items=_stfrCatalogItemsBeforeDurationFilter.call(this);
  if(
    !this._durationConfig().enabled||
    !this._durationFilterActive||
    this._durationLoading||
    !this._durationMovieView()
  )return items;
  return items.filter(item=>stfrDurationPass(this,item));
};
const _stfrCatalogRenderBeforeDurationFilter=StreamingTopFrCatalogCard.prototype._render;
StreamingTopFrCatalogCard.prototype._render=function(){
  const result=_stfrCatalogRenderBeforeDurationFilter.call(this);
  if(this._durationConfig().enabled&&this._durationMovieView()){
    const categories=this.shadowRoot?.querySelector(".category-tabs");
    if(categories&&!this.shadowRoot.querySelector(".duration-filter-row")){
      const row=document.createElement("div");
      row.className="tabs duration-filter-row";
      row.style.cssText="justify-content:center;margin-top:8px";
      row.appendChild(stfrDurationButton(this,"tab"));
      categories.insertAdjacentElement("afterend",row);
    }
    stfrMaybeLoadDuration(this);
  }
  return result;
};

StreamingLocalCard.prototype._durationConfig=function(){
  const cfg=this._data?.duration_filter||{};
  return{
    enabled:cfg.enabled!==false,
    max_minutes:Number(cfg.max_minutes||120),
  };
};
StreamingLocalCard.prototype._durationMovieView=function(){
  return this._effectiveCategory()==="movies";
};
StreamingLocalCard.prototype._durationCandidates=function(){
  if(!this._durationMovieView())return[];
  return this._displayItems(this._category,this._familyCategory).filter(
    item=>String(item?.media_type||"").toLowerCase()==="movie"&&!item?.episodic
  );
};
const _stfrLocalItemsBeforeDurationFilter=StreamingLocalCard.prototype._items;
StreamingLocalCard.prototype._items=function(){
  const items=_stfrLocalItemsBeforeDurationFilter.call(this);
  if(
    !this._durationConfig().enabled||
    !this._durationFilterActive||
    this._durationLoading||
    !this._durationMovieView()
  )return items;
  return items.filter(item=>stfrDurationPass(this,item));
};
const _stfrLocalRenderBeforeDurationFilter=StreamingLocalCard.prototype._render;
StreamingLocalCard.prototype._render=function(){
  const result=_stfrLocalRenderBeforeDurationFilter.call(this);
  if(this._durationConfig().enabled&&this._durationMovieView()){
    const watchRow=this.shadowRoot?.querySelector(".watch-tabs");
    if(watchRow&&!this.shadowRoot.querySelector(".duration-filter-row")){
      const row=document.createElement("div");
      row.className="subtabs duration-filter-row adaptive-tabs";
      row.style.cssText="justify-content:center";
      row.appendChild(stfrDurationButton(this,"subtab"));
      watchRow.parentNode?.insertBefore(row,watchRow);
    }
    stfrMaybeLoadDuration(this);
  }
  return result;
};


// ---------------------------------------------------------------------------
// Streaming Local alphabetical FR movie ordering (v1.0.4)
// Display-only sorting: French localized title for standalone movies, saga
// folder as the alphabetical anchor, chronological order inside each saga.
// ---------------------------------------------------------------------------
StreamingLocalCard.prototype._localFrenchMovieTitle=function(item){
  return String(
    item?.title||
    item?.parsed_title||
    item?.filename||
    ""
  ).trim();
};
StreamingLocalCard.prototype._localSagaLabel=function(item){
  const parts=String(item?.relative_path||"").split("/").filter(Boolean);
  return parts.length>=3?String(parts[1]||"").trim():"";
};
StreamingLocalCard.prototype._sortMovieCollections=function(items){
  const source=[...(items||[])];
  const grouped=new Map();

  for(const item of source){
    const key=this._collectionKey(item);
    if(!key)continue;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(item);
  }

  const sagaKeys=new Set(
    [...grouped.entries()]
      .filter(([,group])=>group.length>1)
      .map(([key])=>key)
  );
  const emitted=new Set();
  const units=[];

  const compareTitle=(a,b)=>String(a||"").localeCompare(
    String(b||""),
    "fr",
    {sensitivity:"base",ignorePunctuation:true,numeric:true}
  );

  for(const item of source){
    const key=this._collectionKey(item);

    if(key&&sagaKeys.has(key)){
      if(emitted.has(key))continue;
      emitted.add(key);

      const members=[...(grouped.get(key)||[])].sort((a,b)=>{
        const ay=Number(a?.year),by=Number(b?.year);
        const aYear=Number.isFinite(ay)&&ay>0?ay:Number.MAX_SAFE_INTEGER;
        const bYear=Number.isFinite(by)&&by>0?by:Number.MAX_SAFE_INTEGER;
        return aYear-bYear||
          compareTitle(
            this._localFrenchMovieTitle(a),
            this._localFrenchMovieTitle(b)
          );
      });

      const sagaLabel=this._localSagaLabel(members[0])||
        this._localFrenchMovieTitle(members[0]);
      units.push({
        sortTitle:sagaLabel,
        items:members,
      });
      continue;
    }

    units.push({
      sortTitle:this._localFrenchMovieTitle(item),
      items:[item],
    });
  }

  units.sort((a,b)=>compareTitle(a.sortTitle,b.sortTitle));
  return units.flatMap(unit=>unit.items);
};



// ---------------------------------------------------------------------------
// Responsive vertical grid + progressive rendering (v1.0.6)
// Presentation-only layer: the validated Streaming, Top Streaming and Local
// engines remain unchanged. Each card reacts to its own width, not to the
// device type, so two cards side-by-side on a desktop can use a compact mode.
//
// v1.0.6:
// - default mode is explicit "Voir N de plus" loading (no nested scroll first)
// - optional per-card/global infinite scroll
// - configurable batch size
// - scroll position is preserved per logical view across re-renders/refreshes
// ---------------------------------------------------------------------------
const STFR_LAYOUT_BREAKPOINT_MEDIUM=700;
const STFR_LAYOUT_BREAKPOINT_LARGE=1200;
const STFR_LAYOUT_DEFAULTS={
  rows_small:2,
  rows_medium:2,
  rows_large:3,
  posters_par_lot:8,
  scroll_infini:false,
};

function stfrClampInt(value,fallback,minimum,maximum){
  const n=Number(value);
  if(!Number.isFinite(n))return fallback;
  return Math.max(minimum,Math.min(maximum,Math.floor(n)));
}

function stfrBool(value,fallback=false){
  if(typeof value==="boolean")return value;
  if(typeof value==="number")return value!==0;
  if(typeof value==="string"){
    const normalized=value.trim().toLowerCase();
    if(["true","yes","1","on","oui"].includes(normalized))return true;
    if(["false","no","0","off","non"].includes(normalized))return false;
  }
  return fallback;
}

function stfrLayoutConfig(card){
  const raw=card instanceof StreamingLocalCard
    ?card?._data?.card_layout
    :card?._data?.settings?.card_layout;
  return{
    rows_small:stfrClampInt(
      raw?.rows_small,STFR_LAYOUT_DEFAULTS.rows_small,1,6
    ),
    rows_medium:stfrClampInt(
      raw?.rows_medium,STFR_LAYOUT_DEFAULTS.rows_medium,1,6
    ),
    rows_large:stfrClampInt(
      raw?.rows_large,STFR_LAYOUT_DEFAULTS.rows_large,1,6
    ),
    posters_par_lot:stfrClampInt(
      raw?.posters_par_lot,STFR_LAYOUT_DEFAULTS.posters_par_lot,1,50
    ),
    scroll_infini:stfrBool(
      raw?.scroll_infini,STFR_LAYOUT_DEFAULTS.scroll_infini
    ),
  };
}

function stfrHasCardOverride(card,key){
  return Boolean(
    card?._config&&
    Object.prototype.hasOwnProperty.call(card._config,key)
  );
}

function stfrBatchSize(card){
  const global=stfrLayoutConfig(card).posters_par_lot;
  return stfrHasCardOverride(card,"posters_par_lot")
    ?stfrClampInt(card._config.posters_par_lot,global,1,50)
    :global;
}

function stfrInfiniteScroll(card){
  const global=stfrLayoutConfig(card).scroll_infini;
  return stfrHasCardOverride(card,"scroll_infini")
    ?stfrBool(card._config.scroll_infini,global)
    :global;
}

function stfrSearchBoxEnabled(card){
  return stfrHasCardOverride(card,"searchbox")
    ?stfrBool(card._config.searchbox,true)
    :true;
}

const STFR_GENRE_ORDER=[
  "action","adventure","animation","comedy","crime","documentary","drama",
  "family","fantasy","history","horror","music","mystery","romance",
  "science_fiction","sport","thriller","war","western"
];
const STFR_GENRE_LABELS={
  action:"Action",adventure:"Aventure",animation:"Animation",comedy:"Comédie",
  crime:"Crime / Policier",documentary:"Documentaire",drama:"Drame",family:"Famille",
  fantasy:"Fantastique",history:"Histoire",horror:"Horreur",music:"Musique",
  mystery:"Mystère",romance:"Romance",science_fiction:"Science-fiction",
  sport:"Sport",thriller:"Thriller",war:"Guerre",western:"Western"
};

function stfrGenreFilterEnabled(card){
  return stfrHasCardOverride(card,"genre_filter")
    ?stfrBool(card._config.genre_filter,true)
    :true;
}
function stfrGenreValue(card){
  return String(card?._stfrGenre||"all");
}
function stfrGenreFilter(card,items){
  const all=Array.isArray(items)?items:[];
  if(!stfrGenreFilterEnabled(card))return all;
  const selected=stfrGenreValue(card);
  if(!selected||selected==="all")return all;
  return all.filter(item=>Array.isArray(item?.genres)&&item.genres.includes(selected));
}
function stfrGenreOptions(card){
  if(!stfrGenreFilterEnabled(card))return[];
  const source=card?._stfrGenreSourceItems?.()||[];
  const found=new Set();
  for(const item of source){
    for(const genre of (Array.isArray(item?.genres)?item.genres:[])){
      if(STFR_GENRE_LABELS[genre])found.add(genre);
    }
  }
  return STFR_GENRE_ORDER.filter(genre=>found.has(genre));
}
function stfrNormalizeGenreSelection(card){
  const options=stfrGenreOptions(card);
  const selected=stfrGenreValue(card);
  if(selected!=="all"&&!options.includes(selected))card._stfrGenre="all";
  return options;
}
function stfrResetGenreView(card){
  card._stfrLayoutStates=new Map();
  card._stfrLayoutKey=null;
  card._stfrLayoutLimit=0;
  card._stfrLayoutExpanded=false;
  card._stfrLayoutFullCount=0;
}
function stfrInstallGenreFilter(card){
  const root=card?.shadowRoot;
  if(!root||!card?._data)return;
  root.querySelector(".stfr-genre-filter")?.remove?.();
  if(!stfrGenreFilterEnabled(card)){card._stfrGenre="all";return;}

  const options=stfrNormalizeGenreSelection(card);
  if(!options.length){card._stfrGenre="all";return;}

  const row=document.createElement("div");
  row.className="stfr-genre-filter";
  row.style.cssText=[
    "display:flex","align-items:center","justify-content:center","gap:8px",
    "margin:2px 0 10px","min-width:0"
  ].join(";");

  const label=document.createElement("label");
  label.style.cssText=[
    "display:flex","align-items:center","gap:6px","font-size:.78rem",
    "font-weight:800","color:var(--secondary-text-color)","white-space:nowrap"
  ].join(";");
  const icon=document.createElement("ha-icon");
  icon.setAttribute("icon","mdi:tag-multiple-outline");
  icon.style.cssText="--mdc-icon-size:18px";
  const text=document.createElement("span");
  text.textContent="Genre";
  label.append(icon,text);

  const select=document.createElement("select");
  select.className="stfr-genre-select";
  select.setAttribute("aria-label","Filtrer par genre");
  select.style.cssText=[
    "max-width:min(260px,70vw)","min-width:150px","border:0","border-radius:999px",
    "padding:8px 30px 8px 12px","background:var(--secondary-background-color)",
    "color:var(--primary-text-color)","font:inherit","font-size:.84rem",
    "font-weight:800","outline:none","cursor:pointer"
  ].join(";");

  const allOption=document.createElement("option");
  allOption.value="all";allOption.textContent="Tous";select.appendChild(allOption);
  for(const genre of options){
    const option=document.createElement("option");
    option.value=genre;
    option.textContent=STFR_GENRE_LABELS[genre]||genre;
    select.appendChild(option);
  }
  select.value=stfrGenreValue(card);

  select.addEventListener("change",event=>{
    event.stopPropagation();
    card._stfrGenre=String(select.value||"all");
    stfrResetGenreView(card);
    card._render?.();
  });
  select.addEventListener("keydown",event=>event.stopPropagation());
  select.addEventListener("keyup",event=>event.stopPropagation());

  row.append(label,select);
  const target=root.querySelector(".stfr-search-box")||
    root.querySelector(".rail")||root.querySelector(".state");
  target?.insertAdjacentElement?.("beforebegin",row);
}
function stfrInstallGenreFeedback(card){
  const root=card?.shadowRoot;
  if(!root||card?._loading||card?._error)return;
  if(stfrSearchNormalize(stfrSearchQuery(card)))return;
  if(stfrGenreValue(card)==="all")return;
  if(Math.max(0,Number(card?._stfrLayoutFullCount)||0)!==0)return;
  const state=root.querySelector(".state");
  if(!state)return;
  const genre=stfrGenreValue(card);
  const label=STFR_GENRE_LABELS[genre]||genre;
  state.textContent="";
  const message=document.createElement("div");
  message.textContent=`Aucun titre pour le genre « ${label} » dans cette sélection.`;
  const reset=document.createElement("button");
  reset.type="button";
  reset.textContent="Afficher tous les genres";
  reset.style.cssText=[
    "margin-top:12px","border:0","border-radius:999px","padding:8px 12px",
    "background:var(--primary-color)","color:#fff","font:inherit","font-weight:800",
    "cursor:pointer"
  ].join(";");
  reset.onclick=()=>{
    card._stfrGenre="all";
    stfrResetGenreView(card);
    card._render?.();
  };
  state.append(message,reset);
}
function stfrGenreDiagnostic(card,item){
  const selected=stfrGenreValue(card);
  const genres=Array.isArray(item?.genres)?item.genres:[];
  return{
    genres_raw:Array.isArray(item?.genres_raw)?item.genres_raw:[],
    genres,
    genre_labels:Array.isArray(item?.genre_labels)?item.genre_labels:[],
    genre_source:item?.genre_source||null,
    genre_filter:selected,
    genre_filter_label:selected==="all"?"Tous":(STFR_GENRE_LABELS[selected]||selected),
    genre_match:selected==="all"||genres.includes(selected),
  };
}
function stfrAppendGenreDebug(card,item){
  const root=card?.shadowRoot;
  const debugEnabled=card instanceof StreamingLocalCard
    ?card?._data?.debug?.enabled===true
    :card?._data?.settings?.debug?.enabled===true;
  if(!root||!debugEnabled)return;
  const modal=root.querySelector(".modalbg .modal");
  if(!modal||modal.querySelector(".stfr-genre-diagnostic"))return;
  const panel=document.createElement("details");
  panel.className="stfr-genre-diagnostic";
  panel.style.cssText="margin:14px 0;border-top:1px solid var(--divider-color);border-bottom:1px solid var(--divider-color);padding:8px 0";
  const summary=document.createElement("summary");
  summary.textContent="Détails techniques — genres";
  summary.style.cssText="cursor:pointer;font-weight:800;color:var(--secondary-text-color)";
  const pre=document.createElement("pre");
  pre.textContent=JSON.stringify(stfrGenreDiagnostic(card,item),null,2);
  pre.style.cssText="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.72rem;line-height:1.35;max-height:240px;overflow:auto;background:var(--secondary-background-color);padding:10px;border-radius:10px";
  panel.append(summary,pre);
  const buttons=modal.querySelector(".buttons,.watch-actions");
  if(buttons)modal.insertBefore(panel,buttons);else modal.appendChild(panel);
}
function stfrWrapGenreDetail(proto){
  const original=proto._detail;
  if(typeof original!=="function"||original._stfrGenreDebug)return;
  const wrapped=function(item,...args){
    const result=original.call(this,item,...args);
    if(result&&typeof result.then==="function"){
      return result.then(value=>{
        stfrAppendGenreDebug(this,item);
        return value;
      });
    }
    stfrAppendGenreDebug(this,item);
    return result;
  };
  wrapped._stfrGenreDebug=true;
  proto._detail=wrapped;
}

function stfrLayoutMode(width){
  const w=Number(width)||0;
  if(w>=STFR_LAYOUT_BREAKPOINT_LARGE)return"large";
  if(w>=STFR_LAYOUT_BREAKPOINT_MEDIUM)return"medium";
  return"small";
}

function stfrLayoutRows(card,width){
  const cfg=stfrLayoutConfig(card);
  const mode=stfrLayoutMode(width);
  return mode==="large"
    ?cfg.rows_large
    :mode==="medium"
    ?cfg.rows_medium
    :cfg.rows_small;
}

function stfrLayoutColumns(width){
  const w=Math.max(240,Number(width)||420);
  // Aim for poster widths close to the historical 145-175 px cards.
  // Very narrow containers still keep two columns for a touch-friendly mobile
  // layout; wider cards gain columns instead of oversized posters.
  return Math.max(2,Math.min(12,Math.floor((w+12)/(150+12))));
}

function stfrLayoutWidth(card){
  const measured=Number(card?.getBoundingClientRect?.().width);
  if(Number.isFinite(measured)&&measured>0)return measured;
  const railWidth=Number(card?.shadowRoot?.querySelector?.(".rail")?.clientWidth);
  if(Number.isFinite(railWidth)&&railWidth>0)return railWidth;
  return Number(card?._stfrLayoutWidth)||420;
}

function stfrLayoutCapacity(card,width=stfrLayoutWidth(card)){
  const columns=stfrLayoutColumns(width);
  return{
    width,
    columns,
    rows:stfrLayoutRows(card,width),
  };
}

function stfrSearchNormalize(value){
  return String(value??"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .trim()
    .toLocaleLowerCase("fr");
}

function stfrSearchText(item){
  return[
    item?.title,
    item?.franchise_title,
    item?.parsed_title,
    item?.original_title,
    item?.episode_title,
    item?.season_title,
    item?.filename,
  ]
    .filter(value=>value!==null&&value!==undefined&&String(value).trim()!=="")
    .map(value=>String(value).trim())
    .join(" ");
}

function stfrSearchQuery(card){
  return String(card?._stfrSearchQuery||"");
}

function stfrSearchFilter(card,items){
  const all=Array.isArray(items)?items:[];
  if(!stfrSearchBoxEnabled(card))return all;
  const query=stfrSearchNormalize(stfrSearchQuery(card));
  if(!query)return all;
  return all.filter(item=>
    stfrSearchNormalize(stfrSearchText(item)).includes(query)
  );
}

function stfrSearchStateKey(card){
  return stfrLayoutKey(card,card?._stfrLayoutKind||"streaming");
}

function stfrResetCurrentSearchState(card){
  const key=stfrSearchStateKey(card);
  card?._stfrLayoutStates?.delete?.(key);
  card._stfrLayoutKey=null;
  card._stfrLayoutLimit=0;
  card._stfrLayoutExpanded=false;
}

function stfrFocusSearch(card,position){
  const restore=()=>{
    const input=card?.shadowRoot?.querySelector?.(".stfr-search-input");
    if(!input)return;
    try{
      input.focus({preventScroll:true});
      const cursor=Math.max(0,Math.min(
        String(input.value||"").length,
        Number.isFinite(Number(position))
          ?Number(position)
          :String(input.value||"").length
      ));
      input.setSelectionRange?.(cursor,cursor);
    }catch(_e){}
  };

  // Home Assistant may perform another focus/layout pass immediately after
  // the card rerender. Restore synchronously, then once on the next microtask
  // and animation frame so continuous typing never falls through to HA
  // keyboard shortcuts.
  restore();
  if(typeof queueMicrotask==="function")queueMicrotask(restore);
  if(typeof requestAnimationFrame==="function")requestAnimationFrame(restore);
}

function stfrInstallSearch(card){
  const root=card?.shadowRoot;
  if(!root||!card?._data)return;

  root.querySelector(".stfr-search-box")?.remove?.();
  if(!stfrSearchBoxEnabled(card))return;

  const target=root.querySelector(".rail")||root.querySelector(".state");
  if(!target)return;

  const box=document.createElement("div");
  box.className="stfr-search-box";
  box.style.cssText=[
    "display:flex",
    "align-items:center",
    "gap:8px",
    "margin:4px 0 12px",
    "padding:8px 10px",
    "border-radius:12px",
    "background:var(--secondary-background-color)",
  ].join(";");

  const icon=document.createElement("ha-icon");
  icon.setAttribute("icon","mdi:magnify");
  icon.style.cssText="flex:0 0 auto;--mdc-icon-size:20px;color:var(--secondary-text-color)";

  const input=document.createElement("input");
  input.className="stfr-search-input";
  input.type="search";
  input.value=stfrSearchQuery(card);
  input.placeholder="Rechercher un titre…";
  input.autocomplete="off";
  input.spellcheck=false;
  input.setAttribute("aria-label","Rechercher dans les titres");
  input.style.cssText=[
    "min-width:0",
    "flex:1 1 auto",
    "border:0",
    "outline:0",
    "background:transparent",
    "color:var(--primary-text-color)",
    "font:inherit",
    "font-size:.92rem",
  ].join(";");

  const count=document.createElement("span");
  count.className="stfr-search-count";
  const query=stfrSearchNormalize(stfrSearchQuery(card));
  const total=Math.max(0,Number(card?._stfrLayoutFullCount)||0);
  count.textContent=query?`${total} résultat${total>1?"s":""}`:"";
  count.style.cssText=[
    "flex:0 0 auto",
    "font-size:.72rem",
    "color:var(--secondary-text-color)",
    "white-space:nowrap",
  ].join(";");

  const clear=document.createElement("button");
  clear.type="button";
  clear.className="stfr-search-clear";
  clear.textContent="×";
  clear.title="Effacer la recherche";
  clear.setAttribute("aria-label","Effacer la recherche");
  clear.style.cssText=[
    "display:"+(query?"grid":"none"),
    "place-items:center",
    "width:28px",
    "height:28px",
    "padding:0",
    "border:0",
    "border-radius:50%",
    "background:transparent",
    "color:var(--secondary-text-color)",
    "font:inherit",
    "font-size:22px",
    "cursor:pointer",
  ].join(";");

  const apply=value=>{
    const cursor=input.selectionStart??String(value||"").length;
    card._stfrSearchQuery=String(value||"");
    card._stfrSearchCaret=cursor;
    stfrResetCurrentSearchState(card);
    card._render();
    stfrFocusSearch(card,cursor);
  };

  // HA registers dashboard-level keyboard shortcuts. Never let keystrokes
  // originating in our search field bubble out of the card.
  const shieldKeyboard=event=>{
    event.stopPropagation();
  };
  input.addEventListener("keydown",event=>{
    shieldKeyboard(event);
    if(event.key==="Escape"&&input.value){
      event.preventDefault();
      apply("");
    }
  });
  input.addEventListener("keypress",shieldKeyboard);
  input.addEventListener("keyup",shieldKeyboard);
  input.addEventListener("input",event=>{
    event.stopPropagation();
    apply(input.value);
  });
  clear.addEventListener("mousedown",event=>event.preventDefault());
  clear.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    input.value="";
    apply("");
  });

  box.append(icon,input,count,clear);
  target.insertAdjacentElement("beforebegin",box);
}
function stfrLayoutKey(card,kind){
  const duration=card?._durationFilterActive?"short":"all";
  const search=stfrSearchNormalize(stfrSearchQuery(card));
  const genre=stfrGenreValue(card);
  if(kind==="streaming"){
    return[
      "streaming",
      card?._provider||"",
      card?._media||"",
      card?._section||"",
      duration,
      genre,
      search,
    ].join(":");
  }
  if(kind==="catalog"){
    return[
      "catalog",
      card?._decade||"",
      card?._category||"",
      card?._familyType||"",
      duration,
      genre,
      search,
    ].join(":");
  }
  return[
    "local",
    card?._category||"",
    card?._familyCategory||"",
    card?._watchFilter||"all",
    duration,
    genre,
    search,
  ].join(":");
}

function stfrViewState(card,key,capacity,full){
  card._stfrLayoutStates=card._stfrLayoutStates||new Map();
  let state=card._stfrLayoutStates.get(key);
  if(!state){
    state={
      limit:Math.min(full,capacity),
      expanded:false,
      scrollTop:0,
    };
    card._stfrLayoutStates.set(key,state);
  }else if(!state.expanded){
    state.limit=Math.min(full,capacity);
  }else{
    state.limit=Math.min(full,Math.max(Number(state.limit)||0,capacity));
  }

  // Infinite scroll starts with one prefetched visual batch so the viewport
  // immediately becomes scrollable. Manual mode stays at exactly the visible
  // row capacity until the user presses "Voir N de plus".
  if(stfrInfiniteScroll(card)&&!state.expanded&&full>capacity){
    state.limit=Math.min(full,capacity+stfrBatchSize(card));
    state.expanded=true;
  }

  return state;
}

function stfrLazyItems(card,items,key){
  const all=Array.isArray(items)?items:[];
  card._stfrLayoutFullCount=all.length;
  if(!card._stfrRendering)return all;

  const metrics=stfrLayoutCapacity(card);
  const capacity=Math.max(1,metrics.columns*metrics.rows);
  const state=stfrViewState(card,key,capacity,all.length);
  card._stfrLayoutKey=key;
  card._stfrLayoutLimit=state.limit;
  card._stfrLayoutExpanded=state.expanded;

  return all.slice(0,Math.min(all.length,state.limit));
}

function stfrStreamingLayoutItems(card,originalItems){
  if(card._section!=="discover")return originalItems.call(card);

  const watched=card._watched();
  const hidden=card._notInterested();
  let items=[...(card._pd()?.[card._media]||[])].filter(
    item=>!watched.has(item.media_key)&&!hidden.has(item.media_key)
  );

  if(
    card._durationConfig?.().enabled&&
    card._durationFilterActive&&
    !card._durationLoading&&
    card._durationMovieView?.()
  ){
    items=items.filter(item=>stfrDurationPass(card,item));
  }
  return items;
}

function stfrGridCardNodes(rail){
  return[...(rail?.children||[])].filter(
    node=>!node.classList?.contains("stfr-lazy-sentinel")
  );
}

function stfrFallbackRowHeight(rail,columns,isLocal){
  const width=Number(rail?.clientWidth)||420;
  const gap=12;
  const cardWidth=Math.max(110,(width-gap*(columns-1))/columns);
  return cardWidth*1.5+(isLocal?72:88);
}

function stfrVisibleGridHeight(rail,columns,rows,isLocal){
  const cards=stfrGridCardNodes(rail);
  if(!cards.length)return 0;
  const fallback=stfrFallbackRowHeight(rail,columns,isLocal);
  let total=0;
  const visibleRows=Math.min(rows,Math.ceil(cards.length/columns));
  for(let row=0;row<visibleRows;row++){
    const slice=cards.slice(row*columns,(row+1)*columns);
    const rowHeight=Math.max(
      fallback,
      ...slice.map(node=>{
        const rectHeight=Number(node?.getBoundingClientRect?.().height);
        if(Number.isFinite(rectHeight)&&rectHeight>0)return rectHeight;
        const offset=Number(node?.offsetHeight);
        return Number.isFinite(offset)&&offset>0?offset:0;
      })
    );
    total+=rowHeight;
  }
  if(visibleRows>1)total+=(visibleRows-1)*12;
  return Math.ceil(total+4);
}

function stfrRememberScroll(card){
  const rail=card?.shadowRoot?.querySelector?.(".rail");
  const key=card?._stfrLayoutKey;
  if(!rail||!key)return;
  const states=card._stfrLayoutStates;
  const state=states?.get?.(key);
  if(state)state.scrollTop=Math.max(0,Number(rail.scrollTop)||0);
}

function stfrScrollableParent(node){
  let current=node;
  while(current){
    if(current instanceof ShadowRoot){
      current=current.host;
      continue;
    }
    current=current.parentNode;
    if(!current)break;
    if(current===document.body||current===document.documentElement)break;
    try{
      const style=getComputedStyle(current);
      const overflow=String(style?.overflowY||"");
      if(
        /auto|scroll|overlay/i.test(overflow)&&
        Number(current.scrollHeight)>Number(current.clientHeight)+1
      )return current;
    }catch(_e){}
  }
  return document.scrollingElement||document.documentElement;
}

function stfrCapturePageScroll(card){
  const scroller=stfrScrollableParent(card);
  const documentScroller=
    scroller===document.scrollingElement||
    scroller===document.documentElement||
    scroller===document.body;
  return{
    scroller,
    documentScroller,
    scrollTop:documentScroller
      ?Math.max(0,Number(window.scrollY)||Number(scroller?.scrollTop)||0)
      :Math.max(0,Number(scroller?.scrollTop)||0),
  };
}

function stfrRestorePageScroll(snapshot){
  if(!snapshot?.scroller)return;
  const restore=()=>{
    if(snapshot.documentScroller){
      window.scrollTo({top:snapshot.scrollTop,left:window.scrollX,behavior:"instant"});
      snapshot.scroller.scrollTop=snapshot.scrollTop;
    }else{
      snapshot.scroller.scrollTop=snapshot.scrollTop;
    }
  };
  // Home Assistant and the browser may both apply scroll anchoring after the
  // DOM replacement. Restore once after layout, then once more on the next
  // frame so "Voir plus" never sends the dashboard back to the card top.
  requestAnimationFrame(()=>{
    restore();
    requestAnimationFrame(restore);
  });
}

function stfrLoadMore(card,rail,count){
  const full=Math.max(0,Number(card?._stfrLayoutFullCount)||0);
  const key=card?._stfrLayoutKey;
  const state=card?._stfrLayoutStates?.get?.(key);
  if(!state||Number(state.limit)>=full||card?._stfrLazyLoading)return;

  const pageScroll=stfrCapturePageScroll(card);
  const increment=stfrClampInt(count,stfrBatchSize(card),1,50);
  card._stfrLazyLoading=true;
  state.scrollTop=Math.max(0,Number(rail?.scrollTop)||0);
  state.expanded=true;
  state.limit=Math.min(full,Math.max(0,Number(state.limit)||0)+increment);
  card._stfrLayoutLimit=state.limit;
  card._stfrLayoutExpanded=true;
  try{
    card._render();
    stfrRestorePageScroll(pageScroll);
  }finally{
    card._stfrLazyLoading=false;
  }
}

function stfrInstallInfiniteTrigger(card,rail,batch){
  card._stfrIntersectionObserver?.disconnect?.();
  card._stfrIntersectionObserver=null;

  const rendered=stfrGridCardNodes(rail).length;
  const full=Math.max(0,Number(card?._stfrLayoutFullCount)||0);
  if(rendered>=full)return;

  const sentinel=document.createElement("div");
  sentinel.className="stfr-lazy-sentinel";
  sentinel.setAttribute("aria-hidden","true");
  sentinel.style.cssText=
    "grid-column:1/-1;height:1px;min-height:1px;pointer-events:none";
  rail.appendChild(sentinel);

  if(typeof IntersectionObserver!=="undefined"){
    card._stfrIntersectionObserver=new IntersectionObserver(
      entries=>{
        if(entries.some(entry=>entry.isIntersecting)){
          stfrLoadMore(card,rail,batch);
        }
      },
      {root:rail,rootMargin:"0px 0px 180px 0px",threshold:0}
    );
    card._stfrIntersectionObserver.observe(sentinel);
    return;
  }

  rail.addEventListener("scroll",()=>{
    if(rail.scrollTop+rail.clientHeight>=rail.scrollHeight-180){
      stfrLoadMore(card,rail,batch);
    }
  },{passive:true});
}

function stfrInstallLoadMoreButton(card,rail,batch){
  const rendered=stfrGridCardNodes(rail).length;
  const full=Math.max(0,Number(card?._stfrLayoutFullCount)||0);
  const remaining=Math.max(0,full-rendered);
  if(!remaining)return;

  const next=Math.min(batch,remaining);
  const button=document.createElement("button");
  button.type="button";
  button.className="stfr-load-more";
  button.textContent=`Voir ${next} de plus ↓`;
  button.setAttribute(
    "aria-label",
    `Afficher ${next} poster${next>1?"s":""} supplémentaire${next>1?"s":""}`
  );
  button.style.cssText=[
    "display:block",
    "margin:10px auto 2px",
    "padding:9px 16px",
    "border:0",
    "border-radius:999px",
    "background:var(--secondary-background-color)",
    "color:var(--primary-text-color)",
    "font:inherit",
    "font-weight:800",
    "cursor:pointer",
  ].join(";");
  // Do not let the temporary button become the focused scroll anchor.
  // _render() removes this node immediately after the click; on mobile/HA,
  // removing the focused element can move the scroll container back to top.
  button.addEventListener("pointerdown",event=>{
    event.preventDefault();
  });
  button.addEventListener("mousedown",event=>{
    event.preventDefault();
  });
  button.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    try{button.blur();}catch(_e){}
    stfrLoadMore(card,rail,batch);
  });
  rail.insertAdjacentElement("afterend",button);
}

function stfrRestoreScroll(card,rail){
  const key=card?._stfrLayoutKey;
  const state=card?._stfrLayoutStates?.get?.(key);
  const target=Math.max(0,Number(state?.scrollTop)||0);
  const restore=()=>{
    if(!rail?.isConnected)return;
    rail.scrollTop=target;
  };
  // The new rail exists immediately after _render(), but Home Assistant and
  // the browser may still recalculate its height/overflow afterwards.
  // Restore once now, then after layout on two consecutive frames.
  restore();
  requestAnimationFrame(()=>{
    restore();
    requestAnimationFrame(restore);
  });
}

function stfrCenterStreamingBuckets(card){
  const root=card?.shadowRoot;
  const first=root?.querySelector?.('[data-section]');
  const row=first?.closest?.(".tabs");
  if(!row)return;

  // Wide cards: keep the status buckets visually centered.
  // Narrow cards: keep normal left-to-right horizontal scrolling so the
  // first bucket never becomes unreachable.
  const width=stfrLayoutWidth(card);
  row.style.justifyContent=width>=700?"center":"flex-start";
}

// ---------------------------------------------------------------------------
// UX consolidation (v1.0.7)
// - explicit no-result search feedback
// - refresh state preservation
// - skeleton on first load while keeping existing content during refresh
// ---------------------------------------------------------------------------
function stfrSearchNoResultMessage(card){
  const raw=String(stfrSearchQuery(card)||"").trim();
  return raw
    ?`Aucun résultat pour « ${raw} ». Essayez un autre titre ou effacez la recherche.`
    :"";
}

function stfrInstallSearchFeedback(card){
  const root=card?.shadowRoot;
  if(!root||card?._loading||card?._error)return;
  const query=String(stfrSearchQuery(card)||"").trim();
  if(!query||Math.max(0,Number(card?._stfrLayoutFullCount)||0)!==0)return;

  const state=root.querySelector(".state");
  if(!state)return;

  state.textContent="";
  state.classList.add("stfr-search-empty");

  const message=document.createElement("div");
  message.className="stfr-search-empty-message";
  message.textContent=stfrSearchNoResultMessage(card);

  const clear=document.createElement("button");
  clear.type="button";
  clear.className="stfr-search-empty-clear";
  clear.textContent="Effacer la recherche";
  clear.style.cssText=[
    "margin-top:12px",
    "padding:8px 14px",
    "border:0",
    "border-radius:999px",
    "background:var(--secondary-background-color)",
    "color:var(--primary-text-color)",
    "font:inherit",
    "font-weight:800",
    "cursor:pointer",
  ].join(";");
  clear.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    card._stfrSearchQuery="";
    stfrResetCurrentSearchState(card);
    card._render();
  });

  state.append(message,clear);
}

function stfrInstallLoadingUx(card){
  const root=card?.shadowRoot;
  if(!root)return;

  const haCard=root.querySelector("ha-card");
  if(haCard)haCard.setAttribute("aria-busy",card?._loading?"true":"false");

  // During an explicit refresh, retain the current cards. This avoids a
  // disruptive blank/reflow while fresh data is fetched.
  if(card?._loading&&card?._data){
    root.querySelector(".rail")?.classList?.add("stfr-refreshing");
    return;
  }

  // Skeletons are only for first load. They mimic the final poster geometry
  // and therefore keep the card height much more stable.
  if(!card?._loading||card?._data)return;
  const state=root.querySelector(".state");
  if(!state)return;

  const width=stfrLayoutWidth(card);
  const columns=stfrLayoutColumns(width);
  const rows=Math.min(2,stfrLayoutRows(card,width));
  const count=Math.max(2,Math.min(12,columns*rows));

  state.textContent="";
  state.classList.add("stfr-loading-state");

  const grid=document.createElement("div");
  grid.className="stfr-skeleton-grid";
  grid.style.cssText=[
    "display:grid",
    `grid-template-columns:repeat(${columns},minmax(0,1fr))`,
    "gap:12px",
    "width:100%",
    "padding:2px 0",
  ].join(";");

  for(let index=0;index<count;index++){
    const item=document.createElement("div");
    item.className="stfr-skeleton-card";
    item.style.cssText=[
      "min-width:0",
      "border-radius:14px",
      "overflow:hidden",
      "background:var(--secondary-background-color)",
      "opacity:.72",
    ].join(";");

    const poster=document.createElement("div");
    poster.style.cssText=[
      "aspect-ratio:2/3",
      "background:linear-gradient(100deg,var(--secondary-background-color) 30%,rgba(127,127,127,.18) 45%,var(--secondary-background-color) 60%)",
      "background-size:220% 100%",
      "animation:stfr-skeleton-shimmer 1.35s ease-in-out infinite",
    ].join(";");

    const text=document.createElement("div");
    text.style.cssText="height:54px;margin:10px;border-radius:8px;background:rgba(127,127,127,.14)";
    item.append(poster,text);
    grid.appendChild(item);
  }

  const style=document.createElement("style");
  style.textContent=`
    @keyframes stfr-skeleton-shimmer{
      0%{background-position:100% 0}
      100%{background-position:-100% 0}
    }
    .stfr-refreshing{opacity:.88;transition:opacity .15s ease}
    @media (prefers-reduced-motion: reduce){
      .stfr-skeleton-card>div:first-child{animation:none!important}
    }
  `;
  state.append(style,grid);
}

function stfrCaptureRefreshState(card){
  return{
    search:String(card?._stfrSearchQuery||""),
    genre:stfrGenreValue(card),
    provider:card?._provider,
    media:card?._media,
    section:card?._section,
    decade:card?._decade,
    category:card?._category,
    familyType:card?._familyType,
    familyCategory:card?._familyCategory,
    watchFilter:card?._watchFilter,
  };
}

function stfrRestoreRefreshState(card,state){
  if(!card||!state)return;

  card._stfrSearchQuery=String(state.search||"");
  card._stfrGenre=String(state.genre||"all");

  if(card instanceof StreamingTopFrCatalogCard){
    const decades=card._decadeOrder?.()||[];
    if(state.decade&&(!decades.length||decades.includes(String(state.decade)))){
      card._decade=String(state.decade);
    }
    const categories=card._categories?.(card._decade)||[];
    if(state.category&&(!categories.length||categories.includes(state.category))){
      card._category=state.category;
    }
    const familyTypes=card._familyTypes?.(card._decade)||[];
    if(state.familyType&&(!familyTypes.length||familyTypes.includes(state.familyType))){
      card._familyType=state.familyType;
    }
    return;
  }

  if(card instanceof StreamingLocalCard){
    const categories=card._categories?.()||[];
    if(state.category&&(!categories.length||categories.includes(state.category))){
      card._category=state.category;
    }
    const familyCategories=card._familyCategories?.()||[];
    if(
      state.familyCategory&&
      (!familyCategories.length||familyCategories.includes(state.familyCategory))
    ){
      card._familyCategory=state.familyCategory;
    }
    if(["all","unwatched","watched"].includes(state.watchFilter)){
      card._watchFilter=state.watchFilter;
    }
    return;
  }

  const providers=card._providerOrder?.()||[];
  if(state.provider&&(!providers.length||providers.includes(state.provider))){
    card._provider=state.provider;
  }
  if(["movies","tv"].includes(state.media))card._media=state.media;
  if(["discover","watchlist","watched","not_interested"].includes(state.section)){
    card._section=state.section;
  }
}

function stfrWrapRefreshPersistence(proto){
  const original=proto._refresh;
  if(typeof original!=="function"||original._stfrRefreshPersistence)return;
  const wrapped=async function(...args){
    const state=stfrCaptureRefreshState(this);
    try{
      return await original.apply(this,args);
    }finally{
      stfrRestoreRefreshState(this,state);
      this._render?.();
    }
  };
  wrapped._stfrRefreshPersistence=true;
  proto._refresh=wrapped;
}

function stfrApplyResponsiveLayout(card){
  stfrInstallSearch(card);
  stfrInstallGenreFilter(card);
  stfrInstallSearchFeedback(card);
  stfrInstallGenreFeedback(card);
  stfrInstallLoadingUx(card);
  if(card instanceof StreamingTopFrCard){
    stfrCenterStreamingBuckets(card);
  }
  const rail=card?.shadowRoot?.querySelector?.(".rail");
  if(!rail)return;

  const hostWidth=stfrLayoutWidth(card);
  card._stfrLayoutWidth=hostWidth;
  const width=Number(rail.clientWidth)||Math.max(240,hostWidth-32);
  const columns=stfrLayoutColumns(width);
  const rows=stfrLayoutRows(card,hostWidth);
  const capacity=Math.max(1,columns*rows);
  const isLocal=card instanceof StreamingLocalCard;
  const batch=stfrBatchSize(card);
  const infinite=stfrInfiniteScroll(card);

  rail.classList.add("stfr-responsive-grid");
  rail.style.setProperty("display","grid","important");
  rail.style.setProperty("grid-auto-flow","row","important");
  rail.style.setProperty("grid-auto-columns","unset","important");
  rail.style.setProperty(
    "grid-template-columns",
    `repeat(${columns},minmax(0,1fr))`,
    "important"
  );
  rail.style.setProperty("overflow-x","hidden","important");
  rail.style.setProperty("scroll-snap-type","none","important");
  rail.style.setProperty("align-items","start","important");
  // Allow the browser to hand the gesture back to the Home Assistant page
  // when the internal viewport reaches an edge.
  rail.style.setProperty("overscroll-behavior-y","auto","important");
  rail.style.setProperty("scrollbar-width","thin","important");

  const rendered=stfrGridCardNodes(rail).length;
  const needsScroll=rendered>capacity;
  if(needsScroll){
    const visibleHeight=stfrVisibleGridHeight(
      rail,columns,rows,isLocal
    );
    if(visibleHeight>0){
      rail.style.setProperty("max-height",`${visibleHeight}px`,"important");
    }
    rail.style.setProperty("overflow-y","auto","important");
  }else{
    rail.style.removeProperty("max-height");
    rail.style.setProperty("overflow-y","visible","important");
  }

  stfrRestoreScroll(card,rail);

  if(infinite){
    stfrInstallInfiniteTrigger(card,rail,batch);
  }else{
    card._stfrIntersectionObserver?.disconnect?.();
    card._stfrIntersectionObserver=null;
    stfrInstallLoadMoreButton(card,rail,batch);
  }

  if(typeof ResizeObserver!=="undefined"&&!card._stfrResizeObserver){
    card._stfrResizeObserver=new ResizeObserver(()=>{
      const previous=Number(card._stfrLayoutWidth)||0;
      const current=stfrLayoutWidth(card);
      if(Math.abs(current-previous)<2)return;
      stfrRememberScroll(card);
      card._stfrLayoutWidth=current;
      card._render();
    });
    card._stfrResizeObserver.observe(card);
  }
}

function stfrCleanupResponsiveLayout(card){
  stfrRememberScroll(card);
  card?._stfrIntersectionObserver?.disconnect?.();
  card?._stfrResizeObserver?.disconnect?.();
  card._stfrIntersectionObserver=null;
  card._stfrResizeObserver=null;
}

function stfrResetResponsiveState(card){
  card._stfrGenre="all";
  card._stfrLayoutStates=new Map();
  card._stfrLayoutKey=null;
  card._stfrLayoutLimit=0;
  card._stfrLayoutExpanded=false;
  card._stfrLayoutFullCount=0;
  card._stfrLayoutWidth=0;
}

function stfrGridOptions(){
  // Ask Home Assistant Sections for the full width available to the card.
  // A section can itself span multiple dashboard columns; using "full" lets
  // the card grow with that section instead of being capped at 12 cells.
  // No fixed HA row count: the card owns its internal viewport.
  return{columns:"full",min_columns:3};
}

StreamingTopFrCard.prototype.getGridOptions=stfrGridOptions;
StreamingTopFrCatalogCard.prototype.getGridOptions=stfrGridOptions;
StreamingLocalCard.prototype.getGridOptions=stfrGridOptions;

StreamingTopFrCard.prototype._stfrLayoutRows=function(width){
  return stfrLayoutRows(this,width);
};
StreamingTopFrCard.prototype._stfrLayoutColumns=function(width){
  return stfrLayoutColumns(width);
};
StreamingTopFrCard.prototype._stfrBatchSize=function(){
  return stfrBatchSize(this);
};
StreamingTopFrCard.prototype._stfrInfiniteScroll=function(){
  return stfrInfiniteScroll(this);
};
StreamingTopFrCard.prototype._stfrSearchNormalize=stfrSearchNormalize;
StreamingTopFrCard.prototype._stfrSearchFilter=function(items){
  return stfrSearchFilter(this,items);
};
StreamingTopFrCard.prototype._stfrSearchBoxEnabled=function(){
  return stfrSearchBoxEnabled(this);
};
StreamingTopFrCard.prototype._stfrGenreFilter=function(items){
  return stfrGenreFilter(this,items);
};
StreamingTopFrCard.prototype._stfrGenreOptions=function(){
  return stfrGenreOptions(this);
};
StreamingLocalCard.prototype._stfrLayoutRows=function(width){
  return stfrLayoutRows(this,width);
};
StreamingLocalCard.prototype._stfrLayoutColumns=function(width){
  return stfrLayoutColumns(width);
};
StreamingLocalCard.prototype._stfrBatchSize=function(){
  return stfrBatchSize(this);
};
StreamingLocalCard.prototype._stfrInfiniteScroll=function(){
  return stfrInfiniteScroll(this);
};
StreamingLocalCard.prototype._stfrSearchNormalize=stfrSearchNormalize;
StreamingLocalCard.prototype._stfrSearchFilter=function(items){
  return stfrSearchFilter(this,items);
};
StreamingLocalCard.prototype._stfrSearchBoxEnabled=function(){
  return stfrSearchBoxEnabled(this);
};
StreamingLocalCard.prototype._stfrGenreFilter=function(items){
  return stfrGenreFilter(this,items);
};
StreamingLocalCard.prototype._stfrGenreOptions=function(){
  return stfrGenreOptions(this);
};

const _stfrResponsiveStreamingItems=StreamingTopFrCard.prototype._items;
StreamingTopFrCard.prototype._items=function(){
  const items=this._stfrRendering
    ?stfrStreamingLayoutItems(this,_stfrResponsiveStreamingItems)
    :_stfrResponsiveStreamingItems.call(this);
  const genreFiltered=stfrGenreFilter(this,items);
  const filtered=stfrSearchFilter(this,genreFiltered);
  return stfrLazyItems(this,filtered,stfrLayoutKey(this,"streaming"));
};

const _stfrResponsiveCatalogItems=StreamingTopFrCatalogCard.prototype._catalogItems;
StreamingTopFrCatalogCard.prototype._catalogItems=function(){
  const items=_stfrResponsiveCatalogItems.call(this);
  const genreFiltered=stfrGenreFilter(this,items);
  const filtered=stfrSearchFilter(this,genreFiltered);
  return stfrLazyItems(this,filtered,stfrLayoutKey(this,"catalog"));
};

const _stfrResponsiveLocalItems=StreamingLocalCard.prototype._items;

StreamingTopFrCard.prototype._stfrGenreSourceItems=function(){
  return stfrStreamingLayoutItems(this,_stfrResponsiveStreamingItems);
};
StreamingTopFrCatalogCard.prototype._stfrGenreSourceItems=function(){
  return _stfrResponsiveCatalogItems.call(this);
};
StreamingLocalCard.prototype._stfrGenreSourceItems=function(){
  return _stfrResponsiveLocalItems.call(this);
};

StreamingLocalCard.prototype._items=function(){
  const items=_stfrResponsiveLocalItems.call(this);
  const genreFiltered=stfrGenreFilter(this,items);
  const filtered=stfrSearchFilter(this,genreFiltered);
  return stfrLazyItems(this,filtered,stfrLayoutKey(this,"local"));
};

function stfrWrapResponsiveRender(proto,kind){
  const original=proto._render;
  proto._render=function(){
    this._stfrLayoutKind=kind;
    stfrRememberScroll(this);
    this._stfrRendering=true;
    try{
      return original.call(this);
    }finally{
      this._stfrRendering=false;
      stfrApplyResponsiveLayout(this);
    }
  };
}

function stfrWrapResponsiveSetConfig(proto){
  const original=proto.setConfig;
  proto.setConfig=function(config){
    stfrResetResponsiveState(this);
    if(
      config&&
      Object.prototype.hasOwnProperty.call(config,"searchbox")&&
      !stfrBool(config.searchbox,true)
    ){
      this._stfrSearchQuery="";
    }
    return original.call(this,config);
  };
}

stfrWrapResponsiveSetConfig(StreamingTopFrCard.prototype);
stfrWrapResponsiveSetConfig(StreamingTopFrCatalogCard.prototype);
stfrWrapResponsiveSetConfig(StreamingLocalCard.prototype);

stfrWrapResponsiveRender(StreamingTopFrCard.prototype,"streaming");
stfrWrapResponsiveRender(StreamingTopFrCatalogCard.prototype,"catalog");
stfrWrapResponsiveRender(StreamingLocalCard.prototype,"local");

stfrWrapRefreshPersistence(StreamingTopFrCard.prototype);
stfrWrapRefreshPersistence(StreamingTopFrCatalogCard.prototype);
stfrWrapRefreshPersistence(StreamingLocalCard.prototype);

stfrWrapGenreDetail(StreamingTopFrCard.prototype);
stfrWrapGenreDetail(StreamingLocalCard.prototype);

StreamingTopFrCard.prototype._stfrSearchNoResultMessage=function(){
  return stfrSearchNoResultMessage(this);
};
StreamingTopFrCard.prototype._stfrCaptureRefreshState=function(){
  return stfrCaptureRefreshState(this);
};
StreamingTopFrCard.prototype._stfrRestoreRefreshState=function(state){
  return stfrRestoreRefreshState(this,state);
};
StreamingLocalCard.prototype._stfrSearchNoResultMessage=function(){
  return stfrSearchNoResultMessage(this);
};
StreamingLocalCard.prototype._stfrCaptureRefreshState=function(){
  return stfrCaptureRefreshState(this);
};
StreamingLocalCard.prototype._stfrRestoreRefreshState=function(state){
  return stfrRestoreRefreshState(this,state);
};

const _stfrResponsiveDisconnect=StreamingTopFrCard.prototype.disconnectedCallback;
StreamingTopFrCard.prototype.disconnectedCallback=function(){
  stfrCleanupResponsiveLayout(this);
  return _stfrResponsiveDisconnect?.call(this);
};
StreamingLocalCard.prototype.disconnectedCallback=function(){
  stfrCleanupResponsiveLayout(this);
};


// Fork addition (1.0.9-stremio.1): "Voir sur Stremio" button.
// Layered on top of the existing popups like the Local copy bridge: any title
// with an IMDb id can be opened on the Stremio detail page of a destination,
// whatever the streaming platform it is listed on.
StreamingTopFrCard.prototype._stremioImdbId=function(item){
  const id=String(item?.imdb_id||"").trim();
  return /^tt\d{5,10}$/.test(id)?id:"";
};
StreamingTopFrCard.prototype._stremioSection=function(item){
  if(!this._directPlaybackEnabled())return"";
  if(!this._supportsPlayback("stremio"))return"";
  const imdb=this._stremioImdbId(item);
  const players=this._players();
  if(!imdb||!players.length)return"";
  const buttons=players.map(pl=>`<button class="stremio" data-stremio-player="${this._esc(pl.id)}" title="Ouvrir la fiche dans Stremio${pl.media_player?` · ${this._esc(pl.media_player)}`:""}" style="background:linear-gradient(rgba(123,91,245,.34),rgba(64,38,160,.44)),rgba(18,14,30,.85)!important;border-color:rgba(140,110,255,.6)!important"><span class="play-brand"><ha-icon icon="mdi:play-circle"></ha-icon></span><span class="playcopy"><strong>Stremio</strong><small>${this._esc(pl.name)}</small></span></button>`).join("");
  return `<div class="service-play stremio-play"><div class="playrow">${buttons}</div></div>`;
};
StreamingTopFrCard.prototype._playStremio=async function(item,playerId,button){
  if(!this._hass||!playerId)return;
  const imdb=this._stremioImdbId(item);if(!imdb)return;
  const old=button?.innerHTML;
  if(button){button.disabled=true;button.innerHTML='<span class="play-brand"><ha-icon icon="mdi:loading"></ha-icon></span><span class="playcopy"><strong>Lancement…</strong></span>'}
  try{
    const msg={type:"streaming_top_fr/play",provider:"stremio",player:playerId,content_id:imdb};
    if(item.media_type)msg.media_type=String(item.media_type);
    if(item.title)msg.title=String(item.title);
    await this._hass.callWS(msg);
    this.shadowRoot?.querySelector(".modalbg")?.remove();
  }catch(e){
    if(button){button.disabled=false;button.innerHTML=old||"Stremio"}
    this._error=`Stremio : ${String(e)}`;
  }
};
const _stfrPlaySectionsBeforeStremio=StreamingTopFrCard.prototype._playSections;
StreamingTopFrCard.prototype._playSections=function(item){
  return _stfrPlaySectionsBeforeStremio.call(this,item)+this._stremioSection(item);
};
const _stfrDetailBeforeStremio=StreamingTopFrCard.prototype._detail;
StreamingTopFrCard.prototype._detail=async function(item){
  const result=await _stfrDetailBeforeStremio.call(this,item);
  const modal=this.shadowRoot?.querySelector(".modalbg");
  modal?.querySelectorAll("[data-stremio-player]").forEach(button=>{
    button.addEventListener("click",async event=>{
      event.stopPropagation();
      await this._playStremio(item,button.dataset.stremioPlayer,button);
    });
  });
  return result;
};


// Fork addition (1.0.9-stremio.2): full-catalogue search.
// The historical search only filters the loaded popularity pool. This layer
// adds a "search the whole catalogue" panel under the search box, backed by
// the streaming_top_fr/catalog_search WebSocket command (JustWatch France).
function stfrCatalogPanelHtml(card,query){
  const st=card._stfrCatalog||{};
  const same=st.query===query;
  const esc=v=>card._esc(v);
  const btnStyle="padding:8px 14px;border:0;border-radius:999px;background:var(--primary-color);color:var(--text-primary-color,#fff);font:inherit;font-weight:800;cursor:pointer";
  if(!same||(!st.loading&&!st.items&&!st.error)){
    return `<div style="display:flex;justify-content:center;margin:10px 0 4px"><button type="button" data-stfr-catalog-go style="${btnStyle}">🔎 Chercher « ${esc(query)} » dans tout le catalogue</button></div>`;
  }
  if(st.loading)return `<div style="text-align:center;margin:12px 0;color:var(--secondary-text-color)">Recherche de « ${esc(query)} » dans tout le catalogue…</div>`;
  if(st.error)return `<div style="text-align:center;margin:12px 0;color:var(--error-color)">${esc(st.error)} <button type="button" data-stfr-catalog-go style="${btnStyle}">Réessayer</button></div>`;
  const items=st.items||[];
  if(!items.length)return `<div style="text-align:center;margin:12px 0;color:var(--secondary-text-color)">Aucun titre trouvé pour « ${esc(query)} » dans le catalogue France.</div>`;
  const tiles=items.map((i,idx)=>{
    const poster=i.poster?`<img src="${esc(i.poster)}" loading="lazy" style="width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:12px;display:block">`:`<div style="width:100%;aspect-ratio:2/3;border-radius:12px;background:var(--secondary-background-color);display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:900">${esc((i.title||"?")[0])}</div>`;
    const where=i.provider_name?esc(i.provider_name):"Stremio";
    const meta=[i.year,i.media_type==="tv"?"Série":"Film",where].filter(Boolean).join(" · ");
    return `<button type="button" data-stfr-catalog-idx="${idx}" style="all:unset;cursor:pointer;display:flex;flex-direction:column;gap:6px;min-width:0">${poster}<b style="font-size:.85rem;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(i.title)}</b><small style="color:var(--secondary-text-color);font-size:.72rem">${meta}</small></button>`;
  }).join("");
  return `<div style="margin:12px 0 6px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><strong style="font-size:.95rem">Tout le catalogue · « ${esc(query)} »</strong><span style="flex:1"></span><button type="button" data-stfr-catalog-close style="border:0;background:none;color:var(--secondary-text-color);font:inherit;cursor:pointer">Masquer</button></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:12px">${tiles}</div></div>`;
}
async function stfrRunCatalogSearch(card,query){
  if(!card._hass)return;
  card._stfrCatalog={query,loading:true};
  card._render?.();
  try{
    const res=await card._hass.callWS({type:"streaming_top_fr/catalog_search",query,media_type:"all",limit:24});
    if((card._stfrCatalog||{}).query!==query)return;
    card._stfrCatalog={query,items:Array.isArray(res?.items)?res.items:[]};
  }catch(e){
    if((card._stfrCatalog||{}).query!==query)return;
    card._stfrCatalog={query,error:`Recherche impossible (${e?.message||e})`};
  }
  card._render?.();
}
function stfrInstallCatalogSearch(card){
  if(!(card instanceof StreamingTopFrCard))return;
  const root=card.shadowRoot;if(!root)return;
  root.querySelector(".stfr-catalog-panel")?.remove();
  const query=String(stfrSearchQuery(card)||"").trim();
  if(query.length<2||card._stfrCatalogHidden===query)return;
  const box=root.querySelector(".stfr-search-box");
  if(!box)return;
  const panel=document.createElement("div");
  panel.className="stfr-catalog-panel";
  panel.innerHTML=stfrCatalogPanelHtml(card,query);
  box.after(panel);
  panel.querySelectorAll("[data-stfr-catalog-go]").forEach(b=>b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();stfrRunCatalogSearch(card,query)}));
  panel.querySelector("[data-stfr-catalog-close]")?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();card._stfrCatalogHidden=query;card._render?.()});
  const items=(card._stfrCatalog||{}).items||[];
  panel.querySelectorAll("[data-stfr-catalog-idx]").forEach(b=>b.addEventListener("click",e=>{
    e.preventDefault();e.stopPropagation();
    const item=items[Number(b.dataset.stfrCatalogIdx)];
    if(item)card._detail(item);
  }));
}
const _stfrApplyResponsiveLayoutBeforeCatalog=stfrApplyResponsiveLayout;
stfrApplyResponsiveLayout=function(card){
  const result=_stfrApplyResponsiveLayoutBeforeCatalog(card);
  try{stfrInstallCatalogSearch(card)}catch(e){console.warn("[Streaming Top FR] catalog search",e)}
  return result;
};
