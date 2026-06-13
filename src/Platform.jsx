import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  ComposedChart, CartesianGrid, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis
} from "recharts";
import * as Tone from "tone";
import Papa from "papaparse";
import _ from "lodash";
import * as math from "mathjs";
import { useAuth } from "./context/AuthContext";
import {
  watchAlerts, addAlert as fbAddAlert, updateAlert as fbUpdateAlert,
  deleteAlert as fbDeleteAlert, addTransaction, getTransactions,
  savePortfolio, getPortfolio, watchSettings,
} from "./firebase";



// Styles loaded in main.jsx

// ── Mock Data ─────────────────────────────────────────────────────────────────
const COINS = [
  { id:"btc", name:"Bitcoin",   sym:"BTC", price:68420.55, chg1h:0.42,  chg24h:2.18,  chg7d:5.40,  mcap:"1.34T", vol:"38.2B", color:"#f7931a" },
  { id:"eth", name:"Ethereum",  sym:"ETH", price:3812.30,  chg1h:-0.18, chg24h:1.55,  chg7d:3.20,  mcap:"458B",  vol:"18.7B", color:"#627eea" },
  { id:"sol", name:"Solana",    sym:"SOL", price:182.44,   chg1h:0.85,  chg24h:-1.20, chg7d:8.90,  mcap:"79.2B", vol:"5.1B",  color:"#9945ff" },
  { id:"avax",name:"Avalanche", sym:"AVAX",price:42.18,    chg1h:-0.30, chg24h:3.40,  chg7d:-2.10, mcap:"17.3B", vol:"1.2B",  color:"#e84142" },
  { id:"link",name:"Chainlink", sym:"LINK",price:18.92,    chg1h:0.65,  chg24h:4.80,  chg7d:11.20, mcap:"11.1B", vol:"890M",  color:"#2a5ada" },
  { id:"dot", name:"Polkadot",  sym:"DOT", price:9.44,     chg1h:-0.10, chg24h:-0.80, chg7d:1.50,  mcap:"12.8B", vol:"620M",  color:"#e6007a" },
  { id:"ada", name:"Cardano",   sym:"ADA", price:0.618,    chg1h:0.20,  chg24h:2.10,  chg7d:-3.80, mcap:"21.7B", vol:"780M",  color:"#0033ad" },
  { id:"matic",name:"Polygon",  sym:"MATIC",price:0.982,   chg1h:1.20,  chg24h:5.60,  chg7d:14.30, mcap:"9.6B",  vol:"510M",  color:"#8247e5" },
];

const genPortfolioHistory = () => {
  const pts = []; let v = 42000;
  for (let i = 90; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    v = Math.max(30000, v + (Math.random() - 0.44) * 1800);
    pts.push({ date: d.toLocaleDateString("en",{month:"short",day:"numeric"}), value: Math.round(v) });
  }
  return pts;
};
const portfolioHistory = genPortfolioHistory();

const genCandles = () => {
  const pts = []; let p = 68000;
  for (let i = 60; i >= 0; i--) {
    const open = p;
    const close = p + (Math.random() - 0.47) * 800;
    const high = Math.max(open, close) + Math.random() * 300;
    const low  = Math.min(open, close) - Math.random() * 300;
    const vol  = Math.round(800 + Math.random() * 1200);
    const d = new Date(); d.setHours(d.getHours() - i);
    pts.push({ time: `${d.getHours()}:00`, open: Math.round(open), close: Math.round(close), high: Math.round(high), low: Math.round(low), vol });
    p = close;
  }
  return pts;
};
const candleData = genCandles();

// ─────────────────────────────────────────────────────────────────────────────
// LIVE DATA: Binance WebSocket (true real-time, no API key needed)
// ─────────────────────────────────────────────────────────────────────────────
const WS_SYMBOLS = ["btcusdt","ethusdt","solusdt","avaxusdt","linkusdt","dotusdt","adausdt","maticusdt"];
const SYM_TO_ID  = { btcusdt:"btc", ethusdt:"eth", solusdt:"sol", avaxusdt:"avax", linkusdt:"link", dotusdt:"dot", adausdt:"ada", maticusdt:"matic" };

const useLivePrices = () => {
  const [live, setLive]           = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError]         = useState(false);
  const [wsConnected, setWsConn]  = useState(false);
  const wsRef                     = useRef(null);
  const liveRef                   = useRef({});

  const connect = useCallback(() => {
    const streams = WS_SYMBOLS.map(s => `${s}@ticker`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    wsRef.current = ws;

    ws.onopen  = () => { setWsConn(true); setError(false); };
    ws.onclose = () => { setWsConn(false); setTimeout(connect, 3000); };
    ws.onerror = () => { setError(true); };

    ws.onmessage = (e) => {
      try {
        const { data: d } = JSON.parse(e.data);
        if (!d) return;
        const sym = d.s?.toLowerCase();
        const id  = SYM_TO_ID[sym];
        if (!id) return;
        liveRef.current[id] = {
          usd:            parseFloat(d.c),
          usd_24h_change: parseFloat(d.P),
          usd_1h_change:  parseFloat(d.P) * 0.18, // estimate
          usd_7d_change:  parseFloat(d.P) * 4.2,  // estimate
          usd_24h_vol:    parseFloat(d.v) * parseFloat(d.c),
          usd_market_cap: parseFloat(d.c) * ({btc:19700000,eth:120000000,sol:430000000,avax:410000000,link:570000000,dot:1400000000,ada:35000000000,matic:9300000000}[id]||1e9),
        };
        setLive({ ...liveRef.current });
        setLastUpdate(new Date());
      } catch(_) {}
    };
  }, []);

  // Fallback: CoinGecko REST if WebSocket fails after 5s
  useEffect(() => {
    connect();
    const fallbackTimer = setTimeout(async () => {
      if (!wsConnected && !live) {
        try {
          const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,avalanche-2,chainlink,polkadot,cardano,matic-network&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true");
          if (r.ok) {
            const d = await r.json();
            const map = { btc:d["bitcoin"], eth:d["ethereum"], sol:d["solana"], avax:d["avalanche-2"], link:d["chainlink"], dot:d["polkadot"], ada:d["cardano"], matic:d["matic-network"] };
            liveRef.current = map;
            setLive(map);
            setLastUpdate(new Date());
            setError(false);
          }
        } catch(_) { setError(true); }
      }
    }, 5000);
    return () => {
      clearTimeout(fallbackTimer);
      wsRef.current?.close();
    };
  }, []);

  return { live, lastUpdate, error, wsConnected };
};

// ── Binance WebSocket: Live Order Book ─────────────────────────────────────
const useLiveOrderBook = (symbol = "btcusdt") => {
  const [book, setBook]   = useState({ bids:ORDER_BOOK_BIDS, asks:ORDER_BOOK_ASKS });
  const [connected, setConn] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@depth10@100ms`);
    wsRef.current = ws;
    ws.onopen  = () => setConn(true);
    ws.onclose = () => setConn(false);
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        const fmt = (arr) => arr.slice(0,8).map(([price,amount]) => ({
          price: parseFloat(price),
          amount: parseFloat(amount),
          total: parseFloat(price) * parseFloat(amount) / 1000
        }));
        setBook({ bids: fmt(d.bids||[]), asks: fmt(d.asks||[]) });
      } catch(_) {}
    };
    return () => ws.close();
  }, [symbol]);

  return { book, connected };
};

// ── Binance WebSocket: Live Trade Feed ────────────────────────────────────
const useLiveTrades = (symbol = "btcusdt") => {
  const [trades, setTrades] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@trade`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        setTrades(prev => [{
          price:  parseFloat(d.p),
          amount: parseFloat(d.q),
          time:   new Date(d.T).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),
          isBuy:  !d.m
        }, ...prev].slice(0, 40));
      } catch(_) {}
    };
    return () => ws.close();
  }, [symbol]);

  return trades;
};

// ── Binance REST: Candlestick data ────────────────────────────────────────
const useLiveCandles = (symbol = "BTCUSDT", interval = "1h") => {
  const [candles, setCandles] = useState(candleData);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=60`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      setCandles(d.map(k => ({
        time:  new Date(k[0]).toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"}),
        open:  parseFloat(k[1]),
        high:  parseFloat(k[2]),
        low:   parseFloat(k[3]),
        close: parseFloat(k[4]),
        vol:   Math.round(parseFloat(k[5]))
      })));
    } catch(_) {
      setCandles(candleData);
    }
    setLoading(false);
  }, [symbol, interval]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { candles, loading, refetch: fetch_ };
};

// Merge live CoinGecko data over the static COINS array
const mergeCoins = (coins, live) => {
  if (!live) return coins;
  return coins.map(c => {
    const d = live[c.id];
    if (!d) return c;
    const fmt = (n) => n >= 1e12 ? `${(n/1e12).toFixed(2)}T` : n >= 1e9 ? `${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : `${n}`;
    return {
      ...c,
      price:  d.usd || c.price,
      chg1h:  d.usd_1h_change  || c.chg1h,
      chg24h: d.usd_24h_change || c.chg24h,
      chg7d:  d.usd_7d_change  || c.chg7d,
      mcap:   d.usd_market_cap ? fmt(d.usd_market_cap)  : c.mcap,
      vol:    d.usd_24h_vol    ? fmt(d.usd_24h_vol)     : c.vol,
    };
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// PRICE TICKER BAR
// ─────────────────────────────────────────────────────────────────────────────
const TickerBar = ({ coins }) => {
  const items = [...coins, ...coins]; // duplicate for seamless loop
  return (
    <div className="ticker-wrap" style={{ background:"var(--bg2)", borderBottom:"1px solid var(--border)", padding:"6px 0" }}>
      <div className="ticker-track" style={{ gap:0 }}>
        {items.map((c,i) => (
          <span key={i} className="mono" style={{ fontSize:11, padding:"0 20px", color:"var(--text)", whiteSpace:"nowrap" }}>
            <span style={{ color:"var(--muted)", marginRight:6 }}>{c.sym}</span>
            <span style={{ marginRight:5 }}>${c.price >= 1000 ? c.price.toLocaleString(undefined,{maximumFractionDigits:0}) : c.price.toFixed(3)}</span>
            <span style={{ color: c.chg24h >= 0 ? "var(--green)" : "var(--red)" }}>
              {c.chg24h >= 0 ? "▲" : "▼"} {Math.abs(c.chg24h).toFixed(2)}%
            </span>
            <span style={{ color:"var(--muted2)", marginLeft:14 }}>·</span>
          </span>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE TRANSITION WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
const PageTransition = ({ children, pageKey }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(false); const t = setTimeout(()=>setVisible(true),10); return()=>clearTimeout(t); }, [pageKey]);
  return (
    <div key={pageKey} style={{ opacity:visible?1:0, transform:visible?"translateY(0)":"translateY(10px)", transition:"opacity .32s ease, transform .32s ease" }}>
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const SkeletonCard = ({ h=80 }) => <div className="skeleton" style={{ height:h, width:"100%", borderRadius:12 }} />;
const SkeletonRow  = ({ w="100%", h=14 }) => <div className="skeleton" style={{ height:h, width:w, borderRadius:4, marginBottom:8 }} />;

// ─────────────────────────────────────────────────────────────────────────────
// AUTH SCREEN  (Login / Register / Forgot)
// ─────────────────────────────────────────────────────────────────────────────
// Auth handled by src/components/AuthScreen.jsx
 ({ onLogin }) => {
  const [view,   setView]   = useState("login"); // login | register | forgot
  const [email,  setEmail]  = useState("");
  const [pass,   setPass]   = useState("");
  const [name,   setName]   = useState("");
  const [pass2,  setPass2]  = useState("");
  const [loading,setLoading]= useState(false);
  const [sent,   setSent]   = useState(false);
  const [showPass,setShowP] = useState(false);
  const [strength,setStrength]=useState(0);

  const pwStrength = (p) => {
    let s=0;
    if(p.length>=8)s++;
    if(/[A-Z]/.test(p))s++;
    if(/[0-9]/.test(p))s++;
    if(/[^A-Za-z0-9]/.test(p))s++;
    return s;
  };
  const strColors=["var(--red)","var(--red)","var(--gold)","var(--green)","var(--green)"];
  const strLabels=["","Weak","Fair","Strong","Very Strong"];

  const handleSubmit = () => {
    setLoading(true);
    setTimeout(()=>{ setLoading(false); if(view!=="forgot") onLogin(name||email.split("@")[0]||"Alex"); else setSent(true); },1200);
  };

  const Input = ({label,value,onChange,type="text",placeholder,right}) => (
    <div style={{marginBottom:16}}>
      <div style={{fontSize:11,color:"var(--muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:0.8}}>{label}</div>
      <div style={{position:"relative"}}>
        <input value={value} onChange={onChange} type={type} placeholder={placeholder}
          style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",color:"var(--text)",fontFamily:"'Syne',sans-serif",fontSize:13,outline:"none",transition:"border-color .2s"}}
          onFocus={e=>e.target.style.borderColor="rgba(240,165,0,0.5)"}
          onBlur={e=>e.target.style.borderColor="var(--border)"}/>
        {right}
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:"radial-gradient(ellipse 80% 60% at 50% -10%,rgba(240,165,0,0.12),transparent),radial-gradient(ellipse 60% 40% at 80% 100%,rgba(99,78,234,0.08),transparent),var(--bg)",
      padding:"20px"}}>

      {/* Floating background orbs */}
      <div style={{position:"fixed",top:"10%",left:"5%",width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(240,165,0,0.04),transparent 70%)",pointerEvents:"none"}}/>
      <div style={{position:"fixed",bottom:"5%",right:"10%",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(99,78,234,0.05),transparent 70%)",pointerEvents:"none"}}/>

      <div className="scale-in" style={{width:"100%",maxWidth:440}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:52,height:52,background:"linear-gradient(135deg,#f0a500,#ffc333)",borderRadius:14,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:800,color:"#000",marginBottom:12,boxShadow:"0 8px 32px rgba(240,165,0,0.3)"}}>◈</div>
          <div style={{fontWeight:800,fontSize:22,letterSpacing:1}}>AURUM</div>
          <div style={{fontSize:11,color:"var(--muted)",letterSpacing:2,marginTop:2}}>CRYPTO PLATFORM</div>
        </div>

        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:20,padding:32,boxShadow:"0 24px 80px rgba(0,0,0,0.4)"}}>

          {view==="login" && (<>
            <div style={{fontWeight:800,fontSize:20,marginBottom:4}}>Welcome back</div>
            <div style={{fontSize:13,color:"var(--muted)",marginBottom:24}}>Sign in to your account</div>

            <Input label="Email" value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@example.com" />
            <Input label="Password" value={pass} onChange={e=>setPass(e.target.value)} type={showPass?"text":"password"} placeholder="••••••••"
              right={<button onClick={()=>setShowP(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:14}}>{showPass?"🙈":"👁"}</button>}/>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"var(--muted)"}}>
                <input type="checkbox" style={{accentColor:"var(--gold)"}}/> Remember me
              </label>
              <span onClick={()=>setView("forgot")} style={{fontSize:12,color:"var(--gold)",cursor:"pointer"}}>Forgot password?</span>
            </div>

            <button onClick={handleSubmit} disabled={loading} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#f0a500,#ffc333)",border:"none",borderRadius:10,cursor:"pointer",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:14,color:"#000",marginBottom:16,opacity:loading?0.7:1,boxShadow:"0 4px 20px rgba(240,165,0,0.3)"}}>
              {loading ? "Signing in…" : "Sign In →"}
            </button>

            <div style={{display:"flex",alignItems:"center",gap:10,margin:"16px 0"}}>
              <div style={{flex:1,height:1,background:"var(--border)"}}/>
              <span style={{fontSize:11,color:"var(--muted)"}}>or continue with</span>
              <div style={{flex:1,height:1,background:"var(--border)"}}/>
            </div>

            <button onClick={onLogin} style={{width:"100%",padding:12,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,cursor:"pointer",fontFamily:"'Syne',sans-serif",fontWeight:600,fontSize:13,color:"var(--text)",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
              <span style={{fontSize:16}}>G</span> Continue with Google
            </button>

            <div style={{textAlign:"center",marginTop:20,fontSize:13,color:"var(--muted)"}}>
              No account? <span onClick={()=>setView("register")} style={{color:"var(--gold)",cursor:"pointer",fontWeight:700}}>Sign up free</span>
            </div>
          </>)}

          {view==="register" && (<>
            <div style={{fontWeight:800,fontSize:20,marginBottom:4}}>Create account</div>
            <div style={{fontSize:13,color:"var(--muted)",marginBottom:24}}>Join 2.4M+ traders on Aurum</div>

            <Input label="Full Name" value={name} onChange={e=>setName(e.target.value)} placeholder="Alex Morgan"/>
            <Input label="Email" value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@example.com"/>

            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,color:"var(--muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:0.8}}>Password</div>
              <div style={{position:"relative"}}>
                <input value={pass} onChange={e=>{setPass(e.target.value);setStrength(pwStrength(e.target.value));}} type={showPass?"text":"password"} placeholder="Min 8 characters"
                  style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",color:"var(--text)",fontFamily:"'Syne',sans-serif",fontSize:13,outline:"none"}}
                  onFocus={e=>e.target.style.borderColor="rgba(240,165,0,0.5)"}
                  onBlur={e=>e.target.style.borderColor="var(--border)"}/>
                <button onClick={()=>setShowP(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:14}}>{showPass?"🙈":"👁"}</button>
              </div>
              {pass && (
                <div style={{marginTop:8}}>
                  <div style={{display:"flex",gap:3,marginBottom:4}}>
                    {[1,2,3,4].map(i=><div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=strength?strColors[strength]:"var(--bg4)",transition:"background .3s"}}/>)}
                  </div>
                  <div style={{fontSize:10,color:strColors[strength]}}>{strLabels[strength]}</div>
                </div>
              )}
            </div>

            <Input label="Confirm Password" value={pass2} onChange={e=>setPass2(e.target.value)} type="password" placeholder="Repeat password"/>

            <label style={{display:"flex",gap:10,alignItems:"flex-start",cursor:"pointer",fontSize:12,color:"var(--muted)",marginBottom:20}}>
              <input type="checkbox" style={{accentColor:"var(--gold)",marginTop:2}}/> I agree to the <span style={{color:"var(--gold)"}}>Terms of Service</span> and <span style={{color:"var(--gold)"}}>Privacy Policy</span>
            </label>

            <button onClick={handleSubmit} disabled={loading} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#f0a500,#ffc333)",border:"none",borderRadius:10,cursor:"pointer",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:14,color:"#000",opacity:loading?0.7:1,boxShadow:"0 4px 20px rgba(240,165,0,0.3)"}}>
              {loading ? "Creating account…" : "Create Account →"}
            </button>

            <div style={{textAlign:"center",marginTop:20,fontSize:13,color:"var(--muted)"}}>
              Have an account? <span onClick={()=>setView("login")} style={{color:"var(--gold)",cursor:"pointer",fontWeight:700}}>Sign in</span>
            </div>
          </>)}

          {view==="forgot" && (<>
            {!sent ? (<>
              <div style={{fontWeight:800,fontSize:20,marginBottom:4}}>Reset password</div>
              <div style={{fontSize:13,color:"var(--muted)",marginBottom:24}}>We'll email you a reset link</div>
              <Input label="Email" value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="you@example.com"/>
              <button onClick={handleSubmit} disabled={loading} style={{width:"100%",padding:14,background:"linear-gradient(135deg,#f0a500,#ffc333)",border:"none",borderRadius:10,cursor:"pointer",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:14,color:"#000",opacity:loading?0.7:1}}>
                {loading?"Sending…":"Send Reset Link"}
              </button>
            </>) : (
              <div style={{textAlign:"center",padding:"20px 0"}}>
                <div style={{fontSize:40,marginBottom:16}}>📧</div>
                <div style={{fontWeight:800,fontSize:18,marginBottom:8}}>Check your inbox</div>
                <div style={{fontSize:13,color:"var(--muted)"}}>We sent a reset link to <strong style={{color:"var(--gold)"}}>{email}</strong></div>
              </div>
            )}
            <div style={{textAlign:"center",marginTop:16,fontSize:13,color:"var(--muted)"}}>
              <span onClick={()=>{setView("login");setSent(false);}} style={{color:"var(--gold)",cursor:"pointer"}}>← Back to login</span>
            </div>
          </>)}

          {/* Security badges */}
          <div style={{display:"flex",justifyContent:"center",gap:16,marginTop:24,paddingTop:20,borderTop:"1px solid var(--border)"}}>
            {["🔒 256-bit SSL","🛡 2FA Protected","❄ Cold Storage"].map(b=>(
              <span key={b} style={{fontSize:10,color:"var(--muted)"}}>{b}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};


const HOLDINGS = [
  { id:"btc", name:"Bitcoin",   sym:"BTC", amount:0.842,  avgBuy:52100, color:"#f7931a" },
  { id:"eth", name:"Ethereum",  sym:"ETH", amount:5.34,   avgBuy:2980,  color:"#627eea" },
  { id:"sol", name:"Solana",    sym:"SOL", amount:48.2,   avgBuy:148,   color:"#9945ff" },
  { id:"avax",name:"Avalanche", sym:"AVAX",amount:120,    avgBuy:38,    color:"#e84142" },
  { id:"link",name:"Chainlink", sym:"LINK",amount:340,    avgBuy:14.2,  color:"#2a5ada" },
];

const TXNS = [
  { type:"Buy",  coin:"BTC",  amount:0.12,  price:67200,  time:"2h ago",   status:"Completed" },
  { type:"Sell", coin:"ETH",  amount:1.5,   price:3780,   time:"5h ago",   status:"Completed" },
  { type:"Buy",  coin:"SOL",  amount:10,    price:179,    time:"1d ago",   status:"Completed" },
  { type:"Deposit", coin:"USDT", amount:5000, price:1,    time:"2d ago",   status:"Completed" },
  { type:"Buy",  coin:"LINK", amount:50,    price:17.8,   time:"3d ago",   status:"Completed" },
];

const WALLET_ASSETS = [
  { sym:"BTC",  name:"Bitcoin",   balance:0.842,  color:"#f7931a" },
  { sym:"ETH",  name:"Ethereum",  balance:5.34,   color:"#627eea" },
  { sym:"SOL",  name:"Solana",    balance:48.2,   color:"#9945ff" },
  { sym:"USDT", name:"Tether",    balance:4218.5, color:"#26a17b" },
  { sym:"AVAX", name:"Avalanche", balance:120,    color:"#e84142" },
];

const ORDER_BOOK_ASKS = [
  { price:68540, amount:0.421, total:28.9 },
  { price:68520, amount:0.832, total:57.0 },
  { price:68510, amount:1.240, total:84.9 },
  { price:68495, amount:0.600, total:41.1 },
  { price:68480, amount:2.100, total:143.8 },
];
const ORDER_BOOK_BIDS = [
  { price:68420, amount:1.800, total:123.2 },
  { price:68400, amount:0.920, total:63.0 },
  { price:68390, amount:3.200, total:218.8 },
  { price:68370, amount:0.740, total:50.6 },
  { price:68350, amount:1.550, total:105.9 },
];

const fmt = (n) => n >= 1e12 ? `$${(n/1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : `$${n.toLocaleString()}`;
const fmtPrice = (p) => p >= 1000 ? `$${p.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : p >= 1 ? `$${p.toFixed(3)}` : `$${p.toFixed(4)}`;
const chgColor = (v) => v >= 0 ? "var(--green)" : "var(--red)";
const chgSign  = (v) => v >= 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`;

// ── Sparkline ─────────────────────────────────────────────────────────────────
const Spark = ({ positive }) => {
  const pts = Array.from({length:10}, (_,i) => ({ v: 50 + (Math.random()-0.45)*30 + (positive?i:-i)*2 }));
  return (
    <ResponsiveContainer width={80} height={32}>
      <LineChart data={pts}>
        <Line dataKey="v" dot={false} stroke={positive?"var(--green)":"var(--red)"} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
};

// ── Shared Components ─────────────────────────────────────────────────────────
const Card = ({ children, style: s, className="", onClick, hover=false }) => (
  <div
    className={"mobile-card " + className}
    onClick={onClick}
    style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"20px 22px", transition:"box-shadow .2s, border-color .2s, transform .2s", cursor:onClick?"pointer":"default", ...s }}
    onMouseEnter={e=>{ if(hover||onClick){e.currentTarget.style.boxShadow="0 8px 32px rgba(240,165,0,0.08)"; e.currentTarget.style.borderColor="rgba(240,165,0,0.2)"; if(onClick) e.currentTarget.style.transform="translateY(-1px)";} }}
    onMouseLeave={e=>{ e.currentTarget.style.boxShadow="none"; e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.transform="none"; }}
  >{children}</div>
);

const Badge = ({ children, color }) => (
  <span style={{ background:`${color}20`, color, border:`1px solid ${color}40`, borderRadius:4, padding:"2px 8px", fontSize:11, fontFamily:"'DM Mono',monospace" }}>{children}</span>
);

const GoldBtn = ({ children, onClick, outline, style: s, disabled=false }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: outline ? "transparent" : disabled ? "var(--bg4)" : "linear-gradient(135deg,#f0a500,#ffc333)",
    color: disabled ? "var(--muted)" : outline ? "var(--gold)" : "#000",
    border: outline ? "1px solid var(--gold)" : disabled ? "1px solid var(--border)" : "none",
    borderRadius: 8, padding:"10px 20px", cursor: disabled ? "not-allowed" : "pointer",
    fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:13,
    boxShadow: outline||disabled ? "none" : "0 2px 12px rgba(240,165,0,0.25)",
    transition:"all .2s", ...s
  }}
  onMouseEnter={e=>{ if(!disabled&&!outline) e.currentTarget.style.boxShadow="0 4px 20px rgba(240,165,0,0.45)"; }}
  onMouseLeave={e=>{ if(!disabled&&!outline) e.currentTarget.style.boxShadow="0 2px 12px rgba(240,165,0,0.25)"; }}
  >{children}</button>
);

const Tab = ({ label, active, onClick }) => (
  <button onClick={onClick} style={{
    background:"none", border:"none", cursor:"pointer",
    color: active ? "var(--gold)" : "var(--muted)",
    fontFamily:"'Syne',sans-serif", fontWeight: active ? 700 : 500,
    fontSize:13, padding:"8px 16px",
    borderBottom: active ? "2px solid var(--gold)" : "2px solid transparent",
    transition:"all .2s"
  }}>{label}</button>
);

const CoinIcon = ({ sym, color, size=28 }) => (
  <div style={{ width:size, height:size, borderRadius:"50%", background:`${color}25`, border:`1.5px solid ${color}60`, display:"flex", alignItems:"center", justifyContent:"center", color, fontSize:size*0.38, fontFamily:"'Syne',sans-serif", fontWeight:800, flexShrink:0 }}>
    {sym[0]}
  </div>
);

// ── Custom Tooltip ────────────────────────────────────────────────────────────
const ChartTip = ({ active, payload, label, prefix="$" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 14px" }}>
      <div style={{ color:"var(--muted)", fontSize:11, marginBottom:4 }}>{label}</div>
      <div style={{ color:"var(--gold)", fontFamily:"'DM Mono',monospace", fontSize:14, fontWeight:500 }}>{prefix}{payload[0].value?.toLocaleString()}</div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
const Dashboard = ({ coins = COINS }) => {
  const [range, setRange] = useState("1M");
  const ranges = { "1D":1, "1W":7, "1M":30, "3M":90 };
  const slice = portfolioHistory.slice(-ranges[range]);
  const totalVal = HOLDINGS.reduce((a,h) => a + (coins.find(c=>c.id===h.id)||{price:h.avgBuy}).price * h.amount, 0);
  const totalCost = HOLDINGS.reduce((a,h) => a + h.avgBuy * h.amount, 0);
  const pnl24h = totalVal - totalCost;
  const ret = ((totalVal - totalCost) / totalCost * 100);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      {/* Hero stats */}
      <div className="rg-4" style={{ gap:14 }}>
        {[
          { label:"Portfolio Value", val:`$${totalVal.toLocaleString(undefined,{maximumFractionDigits:0})}`, sub:`${pnl24h>=0?"+":""}$${Math.abs(pnl24h).toLocaleString(undefined,{maximumFractionDigits:0})} cost basis`, subColor:pnl24h>=0?"var(--green)":"var(--red)" },
          { label:"Unrealized P&L",  val:`${pnl24h>=0?"+":""}$${Math.abs(pnl24h).toLocaleString(undefined,{maximumFractionDigits:0})}`, sub:`vs cost basis`, subColor:pnl24h>=0?"var(--green)":"var(--red)" },
          { label:"Total Return",    val:`${ret>=0?"+":""}${ret.toFixed(1)}%`, sub:"vs cost basis", subColor:ret>=0?"var(--green)":"var(--red)" },
          { label:"Active Positions",val:"5", sub:"across 5 assets", subColor:"var(--muted)" },
        ].map((s,i) => (
          <Card key={i} className={`fade-up-${i+1}`} style={{ position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", top:0, right:0, width:60, height:60, background:"radial-gradient(circle,var(--goldDim),transparent 70%)" }} />
            <div style={{ color:"var(--muted)", fontSize:11, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>{s.label}</div>
            <div className="mono" style={{ fontSize:22, fontWeight:500, color:"var(--text)", marginBottom:4 }}>{s.val}</div>
            <div style={{ fontSize:12, color:s.subColor }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      <div className="rg-chart" style={{ gap:14 }}>
        {/* Portfolio chart */}
        <Card className="fade-up-2">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div>
              <div style={{ fontSize:13, color:"var(--muted)", marginBottom:2 }}>Portfolio Performance</div>
              <div className="mono" style={{ fontSize:24, color:"var(--gold)", fontWeight:500 }}>${totalVal.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
            </div>
            <div style={{ display:"flex", gap:4 }}>
              {["1D","1W","1M","3M"].map(r => (
                <button key={r} onClick={() => setRange(r)} style={{ background: range===r ? "var(--goldDim)" : "none", border: range===r ? "1px solid var(--gold)" : "1px solid var(--border)", color: range===r ? "var(--gold)" : "var(--muted)", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:12, fontFamily:"'DM Mono',monospace" }}>{r}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={window.innerWidth < 768 ? 160 : 200}>
            <AreaChart data={slice}>
              <defs>
                <linearGradient id="pGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f0a500" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#f0a500" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{fill:"var(--muted)",fontSize:10}} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis hide domain={["auto","auto"]} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="value" stroke="var(--gold)" strokeWidth={2} fill="url(#pGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Allocation donut */}
        <Card className="fade-up-3">
          <div style={{ fontSize:13, color:"var(--muted)", marginBottom:12 }}>Allocation</div>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie data={HOLDINGS.map(h => ({ name:h.sym, value: Math.round(COINS.find(c=>c.id===h.id).price * h.amount) }))} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value">
                {HOLDINGS.map((h,i) => <Cell key={i} fill={h.color} />)}
              </Pie>
              <Tooltip formatter={(v) => [`$${v.toLocaleString()}`, ""]} contentStyle={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, fontFamily:"'DM Mono',monospace" }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
            {HOLDINGS.map(h => {
              const val = Math.round(COINS.find(c=>c.id===h.id).price * h.amount);
              const pct = ((val/totalVal)*100).toFixed(1);
              return (
                <div key={h.id} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
                  <div style={{ width:8, height:8, borderRadius:2, background:h.color, flexShrink:0 }} />
                  <span style={{ color:"var(--muted)", flex:1 }}>{h.sym}</span>
                  <span className="mono" style={{ color:"var(--text)" }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Fear & Greed + Market Stats */}
      {(() => {
        const [fgi, setFgi] = useState(null);
        useEffect(() => {
          fetch("https://api.alternative.me/fng/?limit=1")
            .then(r=>r.json())
            .then(d=>setFgi(d?.data?.[0]))
            .catch(()=>{});
        }, []);
        const score = fgi ? parseInt(fgi.value) : 62;
        const label = fgi?.value_classification || "Greed";
        const fgiColor = score <= 25 ? "var(--red)" : score <= 45 ? "#f97316" : score <= 55 ? "var(--muted)" : score <= 75 ? "var(--green)" : "#00ff88";
        const deg = (score / 100) * 180;

        return (
          <div className="rg-4" style={{ gap:12 }}>
            <Card style={{ padding:"16px 14px", gridColumn:"span 1" }}>
              <div style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.8, marginBottom:10 }}>Fear & Greed Index</div>
              <div style={{ textAlign:"center" }}>
                <svg width="100" height="56" viewBox="0 0 100 56" style={{ display:"block", margin:"0 auto" }}>
                  <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="var(--bg4)" strokeWidth="8" strokeLinecap="round"/>
                  <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke={fgiColor} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${(deg/180)*125.6} 125.6`}/>
                  <text x="50" y="46" textAnchor="middle" fill={fgiColor} fontSize="16" fontWeight="800" fontFamily="'DM Mono',monospace">{score}</text>
                </svg>
                <div style={{ fontSize:11, fontWeight:700, color:fgiColor, marginTop:2 }}>{label}</div>
              </div>
            </Card>
            {[
              { label:"BTC Dominance", val:`${(42 + Math.random()*4).toFixed(1)}%`,  color:"#f7931a" },
              { label:"Total Mkt Cap",  val:"$2.41T",  color:"var(--text)" },
              { label:"24h Volume",     val:"$98.2B",  color:"var(--text)" },
            ].map(s => (
              <Card key={s.label} style={{ padding:"16px 14px" }}>
                <div style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>{s.label}</div>
                <div className="mono" style={{ fontSize:20, color:s.color, fontWeight:500 }}>{s.val}</div>
              </Card>
            ))}
          </div>
        );
      })()}

      {/* Top movers + Transactions */}
      <div className="rg-2" style={{ gap:14 }}>
        <Card className="fade-up-3">
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
            <span style={{ fontSize:13, color:"var(--muted)" }}>Top Movers
              <span className="mono" style={{ fontSize:10, color:"var(--muted2)", marginLeft:8 }}>24h</span>
            </span>
            <span style={{ fontSize:11, color:"var(--gold)", cursor:"pointer" }}>See all →</span>
          </div>
          {coins.slice(0,5).map(c => (
            <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
              <CoinIcon sym={c.sym} color={c.color} size={30} />
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{c.name}</div>
                <div className="mono" style={{ fontSize:11, color:"var(--muted)" }}>{c.sym}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div className="mono" style={{ fontSize:13 }}>{fmtPrice(c.price)}</div>
                <div className="mono" style={{ fontSize:11, color:chgColor(c.chg24h) }}>{chgSign(c.chg24h)}</div>
              </div>
              <Spark positive={c.chg24h >= 0} />
            </div>
          ))}
        </Card>

        <Card className="fade-up-4">
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
            <span style={{ fontSize:13, color:"var(--muted)" }}>Recent Transactions</span>
            <span style={{ fontSize:11, color:"var(--gold)", cursor:"pointer" }}>View all →</span>
          </div>
          {TXNS.map((t,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderBottom:"1px solid var(--border)" }}>
              <div style={{ width:34, height:34, borderRadius:8, background: t.type==="Buy"||t.type==="Deposit" ? "rgba(0,228,154,0.12)" : "rgba(255,77,109,0.12)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>
                {t.type==="Buy"||t.type==="Deposit" ? "↓" : "↑"}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{t.type} {t.coin}</div>
                <div className="mono" style={{ fontSize:11, color:"var(--muted)" }}>{t.time}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div className="mono" style={{ fontSize:13 }}>{t.amount} {t.coin}</div>
                <div className="mono" style={{ fontSize:11, color:"var(--muted)" }}>{fmtPrice(t.price)}</div>
              </div>
              <Badge color="var(--green)">{t.status}</Badge>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: MARKETS
// ─────────────────────────────────────────────────────────────────────────────
const Markets = ({ coins = COINS }) => {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key:"mcap", dir:"desc" });
  const filtered = COINS.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.sym.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <div style={{ position:"relative", flex:1, maxWidth:320 }}>
          <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", fontSize:14 }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search coins…"
            style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px 10px 36px", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:13, outline:"none" }} />
        </div>
        {["All","DeFi","Layer1","Layer2","Stablecoins"].map(f => (
          <button key={f} style={{ background:f==="All"?"var(--goldDim)":"var(--bg3)", border: f==="All"?"1px solid var(--gold)":"1px solid var(--border)", color:f==="All"?"var(--gold)":"var(--muted)", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontSize:12, fontFamily:"'Syne',sans-serif" }}>{f}</button>
        ))}
      </div>

      <Card style={{ padding:0, overflow:"hidden" }}>
        <div className="table-wrap">
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:700 }}>
          <thead>
            <tr style={{ borderBottom:"1px solid var(--border)" }}>
              {[["#",""],["Asset",""],["Price",""],["1h%",""],["24h%",""],["7d%",""],["Market Cap",""],["Volume",""],["7D Chart",""],["",""]].map(([h,k],i) => (
                <th key={i} style={{ padding:"14px 16px", textAlign:i===0||i>=8?"center":"left", fontSize:11, color:"var(--muted)", fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", cursor:k?"pointer":"default" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c,i) => (
              <tr key={c.id} style={{ borderBottom:"1px solid var(--border)", transition:"background .15s", cursor:"pointer" }}
                onMouseEnter={e=>e.currentTarget.style.background="var(--bg3)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td className="mono" style={{ padding:"14px 16px", textAlign:"center", color:"var(--muted)", fontSize:12 }}>{i+1}</td>
                <td style={{ padding:"14px 16px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <CoinIcon sym={c.sym} color={c.color} size={32} />
                    <div>
                      <div style={{ fontWeight:700, fontSize:13 }}>{c.name}</div>
                      <div className="mono" style={{ fontSize:11, color:"var(--muted)" }}>{c.sym}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding:"14px 16px", fontSize:13 }}><PriceFlash value={c.price} decimals={c.price>=100?2:4} prefix="$"/></td>
                <td className="mono" style={{ padding:"14px 16px", fontSize:12, color:chgColor(c.chg1h) }}>{chgSign(c.chg1h)}</td>
                <td className="mono" style={{ padding:"14px 16px", fontSize:12, color:chgColor(c.chg24h) }}>{chgSign(c.chg24h)}</td>
                <td className="mono" style={{ padding:"14px 16px", fontSize:12, color:chgColor(c.chg7d) }}>{chgSign(c.chg7d)}</td>
                <td className="mono" style={{ padding:"14px 16px", fontSize:12, color:"var(--muted)" }}>${c.mcap}</td>
                <td className="mono" style={{ padding:"14px 16px", fontSize:12, color:"var(--muted)" }}>${c.vol}</td>
                <td style={{ padding:"14px 8px" }}><Spark positive={c.chg7d >= 0} /></td>
                <td style={{ padding:"14px 16px", textAlign:"center" }}>
                  <GoldBtn style={{ padding:"5px 14px", fontSize:11 }}>Trade</GoldBtn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: PORTFOLIO
// ─────────────────────────────────────────────────────────────────────────────
const Portfolio = ({ coins = COINS }) => {
  const totalInvested = HOLDINGS.reduce((a,h) => a + h.avgBuy * h.amount, 0);
  const currentVal = HOLDINGS.reduce((a,h) => a + (coins.find(c=>c.id===h.id)||{price:h.avgBuy}).price * h.amount, 0);
  const pnl = currentVal - totalInvested;
  const pnlPct = (pnl/totalInvested)*100;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Summary cards */}
      <div className="rg-4" style={{ gap:14 }}>
        {[
          { label:"Total Invested",  val:`$${totalInvested.toLocaleString(undefined,{maximumFractionDigits:0})}`, color:"var(--text)" },
          { label:"Current Value",   val:`$${currentVal.toLocaleString(undefined,{maximumFractionDigits:0})}`, color:"var(--gold)" },
          { label:"Unrealized P&L",  val:`${pnl>=0?"+":""}$${Math.abs(pnl).toLocaleString(undefined,{maximumFractionDigits:0})}`, color:chgColor(pnl) },
          { label:"Return",          val:`${pnlPct>=0?"+":""}${pnlPct.toFixed(1)}%`, color:chgColor(pnlPct) },
        ].map((s,i) => (
          <Card key={i}>
            <div style={{ fontSize:11, color:"var(--muted)", letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>{s.label}</div>
            <div className="mono" style={{ fontSize:22, color:s.color, fontWeight:500 }}>{s.val}</div>
          </Card>
        ))}
      </div>

      <div className="rg-2-3" style={{ gap:14 }}>
        {/* Holdings table */}
        <Card style={{ padding:0, overflow:"hidden" }}>
          <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--border)", fontSize:13, color:"var(--muted)" }}>Holdings</div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:"1px solid var(--border)" }}>
                {["Asset","Amount","Avg Buy","Current","Value","P&L","24h"].map(h => (
                  <th key={h} style={{ padding:"11px 16px", textAlign:"left", fontSize:10, color:"var(--muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOLDINGS.map(h => {
                const coin = coins.find(c=>c.id===h.id) || {price:h.avgBuy,chg24h:0};
                const cur = coin.price;
                const val = cur * h.amount;
                const pnl = (cur - h.avgBuy) * h.amount;
                const pnlP = ((cur-h.avgBuy)/h.avgBuy)*100;
                return (
                  <tr key={h.id} style={{ borderBottom:"1px solid var(--border)" }}>
                    <td style={{ padding:"14px 16px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <CoinIcon sym={h.sym} color={h.color} size={28} />
                        <div>
                          <div style={{ fontWeight:600, fontSize:12 }}>{h.sym}</div>
                          <div style={{ fontSize:10, color:"var(--muted)" }}>{h.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono" style={{ padding:"14px 16px", fontSize:12 }}>{h.amount}</td>
                    <td className="mono" style={{ padding:"14px 16px", fontSize:12, color:"var(--muted)" }}>{fmtPrice(h.avgBuy)}</td>
                    <td className="mono" style={{ padding:"14px 16px", fontSize:12 }}>{fmtPrice(cur)}</td>
                    <td className="mono" style={{ padding:"14px 16px", fontSize:12 }}>${val.toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                    <td className="mono" style={{ padding:"14px 16px", fontSize:12, color:chgColor(pnl) }}>{pnl>=0?"+":""}{pnlP.toFixed(1)}%</td>
                    <td className="mono" style={{ padding:"14px 16px", fontSize:12, color:chgColor(coin.chg24h) }}>{chgSign(coin.chg24h)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {/* Donut */}
        <Card>
          <div style={{ fontSize:13, color:"var(--muted)", marginBottom:12 }}>Allocation</div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={HOLDINGS.map(h => ({ name:h.sym, value: Math.round((coins.find(c=>c.id===h.id)||{price:h.avgBuy}).price*h.amount) }))} cx="50%" cy="50%" innerRadius={45} outerRadius={68} paddingAngle={3} dataKey="value">
                {HOLDINGS.map((h,i) => <Cell key={i} fill={h.color} />)}
              </Pie>
              <Tooltip formatter={(v)=>[`$${v.toLocaleString()}`,""]} contentStyle={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8}} />
            </PieChart>
          </ResponsiveContainer>
          {HOLDINGS.map(h => {
            const val = Math.round((coins.find(c=>c.id===h.id)||{price:h.avgBuy}).price*h.amount);
            return (
              <div key={h.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", fontSize:11 }}>
                <div style={{ width:7,height:7,borderRadius:2,background:h.color }} />
                <span style={{ flex:1, color:"var(--muted)" }}>{h.sym}</span>
                <span className="mono">${val.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
              </div>
            );
          })}
        </Card>
        {/* Radar diversification */}
        <Card>
          <div style={{ fontSize:13, color:"var(--muted)", marginBottom:8 }}>Diversification Score</div>
          <ResponsiveContainer width="100%" height={170}>
            <RadarChart data={[
              { metric:"Layer 1",  score:82 },
              { metric:"DeFi",     score:45 },
              { metric:"Stability",score:30 },
              { metric:"Volume",   score:70 },
              { metric:"Growth",   score:88 },
              { metric:"Risk Adj.",score:61 },
            ]}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="metric" tick={{fill:"var(--muted)",fontSize:9}} />
              <Radar dataKey="score" stroke="var(--gold)" fill="var(--gold)" fillOpacity={0.15} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: TRADE
// ─────────────────────────────────────────────────────────────────────────────
const Trade = ({ coins = COINS, addTradeToast }) => {
  const btcLive  = coins.find(c=>c.id==="btc");
  const [side,      setSide]      = useState("Buy");
  const [orderType, setOrderType] = useState("Market");
  const [amount,    setAmount]    = useState("");
  const [price,     setPrice]     = useState(btcLive?.price?.toFixed(2) || "68420.55");
  const [pct,       setPct]       = useState(0);
  const [pair,      setPair]      = useState("BTCUSDT");
  const [interval_, setInterval_] = useState("1h");

  const { book, connected: bookConn } = useLiveOrderBook(pair.toLowerCase());
  const liveTrades                    = useLiveTrades(pair.toLowerCase());
  const { candles, loading: candLoading } = useLiveCandles(pair, interval_);

  useEffect(() => {
    if (btcLive?.price && orderType === "Market")
      setPrice(btcLive.price.toFixed(2));
  }, [btcLive?.price]);

  const total = (parseFloat(amount||0) * parseFloat(price||0)).toFixed(2);
  const fee   = (parseFloat(total) * 0.001).toFixed(2);

  const chartData = candles.map(d => ({
    ...d,
    barFill: d.close >= d.open ? "var(--green)" : "var(--red)"
  }));

  return (
    <div className="rg-trade" style={{ gap:14, minHeight:500 }}>
      {/* Chart side */}
      <div style={{ display:"flex", flexDirection:"column", gap:14, overflow:"hidden" }}>
        {/* Pair + stats bar */}
        <Card style={{ padding:"14px 18px", display:"flex", alignItems:"center", gap:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <CoinIcon sym={pair.replace("USDT","")} color={coins.find(c=>c.sym===pair.replace("USDT",""))?.color||"#f7931a"} size={34} />
            <div>
              <div style={{ fontWeight:800, fontSize:15 }}>{pair.replace("USDT","")} / USDT</div>
              <div style={{ fontSize:11, color:"var(--muted)" }}>{coins.find(c=>c.sym===pair.replace("USDT",""))?.name||"Bitcoin"}</div>
            </div>
          </div>
          <select value={pair} onChange={e=>setPair(e.target.value)} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"6px 10px", color:"var(--gold)", fontFamily:"'DM Mono',monospace", fontSize:12, outline:"none", cursor:"pointer" }}>
            {["BTCUSDT","ETHUSDT","SOLUSDT","AVAXUSDT","LINKUSDT"].map(p=><option key={p} value={p}>{p.replace("USDT","/USDT")}</option>)}
          </select>
          <div style={{ height:30, width:1, background:"var(--border)" }} />
          {[
            { label:"Price",    val:fmtPrice(btcLive?.price||68420), color:(btcLive?.chg24h||2)>=0?"var(--green)":"var(--red)" },
            { label:"24h %",    val:chgSign(btcLive?.chg24h||2.18),  color:(btcLive?.chg24h||2)>=0?"var(--green)":"var(--red)" },
            { label:"24h High", val:fmtPrice((btcLive?.price||68420)*1.01),  color:"var(--text)" },
            { label:"24h Low",  val:fmtPrice((btcLive?.price||68420)*0.976), color:"var(--text)" },
            { label:"Volume",   val:btcLive?.vol||"38.2B",            color:"var(--text)" },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.8 }}>{s.label}</div>
              <div className="mono" style={{ fontSize:13, color:s.color, fontWeight:500 }}>{s.val}</div>
            </div>
          ))}
        </Card>

        {/* Price chart */}
        <Card style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0 }}>
          <div style={{ display:"flex", gap:4, marginBottom:12 }}>
            {[["1m","1m"],["5m","5m"],["15m","15m"],["1h","1h"],["4h","4h"],["1D","1d"],["1W","1w"]].map(([label,val]) => (
              <button key={val} onClick={()=>setInterval_(val)} style={{ background:interval_===val?"var(--goldDim)":"none", border:interval_===val?"1px solid var(--gold)":"1px solid transparent", color:interval_===val?"var(--gold)":"var(--muted)", borderRadius:6, padding:"3px 9px", cursor:"pointer", fontSize:11, fontFamily:"'DM Mono',monospace", transition:"all .15s" }}>{label}</button>
            ))}
            {candLoading && <span style={{ fontSize:10, color:"var(--muted)", alignSelf:"center", marginLeft:4 }}>Loading…</span>}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--bg4)" />
              <XAxis dataKey="time" tick={{fill:"var(--muted)",fontSize:9}} axisLine={false} tickLine={false} interval={9} />
              <YAxis domain={["auto","auto"]} tick={{fill:"var(--muted)",fontSize:9}} axisLine={false} tickLine={false} orientation="right" />
              <Tooltip contentStyle={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,fontFamily:"'DM Mono',monospace",fontSize:11}} />
              <Bar dataKey="close" fill="var(--gold)" opacity={0.7} />
              <Line dataKey="high" dot={false} stroke="var(--green)" strokeWidth={1} strokeDasharray="2 2" />
              <Line dataKey="low" dot={false} stroke="var(--red)" strokeWidth={1} strokeDasharray="2 2" />
            </ComposedChart>
          </ResponsiveContainer>
          {/* Volume */}
          <ResponsiveContainer width="100%" height={60}>
            <BarChart data={chartData}>
              <Bar dataKey="vol" fill="var(--muted2)" radius={[2,2,0,0]} />
              <XAxis hide /><YAxis hide />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Order book */}
        <div className="orderbook-grid rg-2" style={{ gap:14 }}>
          {[
            { label:"Asks", data:book.asks, color:"var(--red)" },
            { label:"Bids", data:book.bids, color:"var(--green)" },
          ].map(({ label, data, color }) => (
            <Card key={label} style={{ padding:"14px 16px" }}>
              <div style={{ fontSize:11, color:"var(--muted)", marginBottom:10, textTransform:"uppercase", letterSpacing:0.8 }}>{label}</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", fontSize:10, color:"var(--muted)", marginBottom:6, gap:4 }}>
                <span>Price</span><span style={{textAlign:"center"}}>Amount</span><span style={{textAlign:"right"}}>Total</span>
              </div>
              {data.map((r,i) => (
                <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", fontSize:11, fontFamily:"'DM Mono',monospace", padding:"3px 0", gap:4 }}>
                  <span style={{ color }}>{r.price.toLocaleString()}</span>
                  <span style={{ textAlign:"center", color:"var(--text)" }}>{r.amount.toFixed(3)}</span>
                  <span style={{ textAlign:"right", color:"var(--muted)" }}>{r.total.toFixed(1)}K</span>
                </div>
              ))}
            </Card>
          ))}
        </div>
      </div>

      {/* Order form */}
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        <Card>
          {/* Buy/Sell toggle */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", marginBottom:16, background:"var(--bg3)", borderRadius:8, padding:3 }}>
            {["Buy","Sell"].map(s => (
              <button key={s} onClick={()=>setSide(s)} style={{ background: side===s ? (s==="Buy"?"var(--green)":"var(--red)") : "transparent", color: side===s ? "#000" : "var(--muted)", border:"none", borderRadius:6, padding:"9px", cursor:"pointer", fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:13, transition:"all .2s" }}>{s}</button>
            ))}
          </div>

          {/* Order type */}
          <div style={{ display:"flex", gap:4, marginBottom:16 }}>
            {["Market","Limit","Stop"].map(t => <Tab key={t} label={t} active={orderType===t} onClick={()=>setOrderType(t)} />)}
          </div>

          {orderType !== "Market" && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>Price (USDT)</div>
              <input value={price} onChange={e=>setPrice(e.target.value)} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--gold)", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none" }} />
            </div>
          )}

          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>Amount (BTC)</div>
            <input value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.000" style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none" }} />
          </div>

          {/* Quick % */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:16 }}>
            {[25,50,75,100].map(p => (
              <button key={p} onClick={()=>setPct(p)} style={{ background:pct===p?"var(--goldDim)":"var(--bg3)", border:pct===p?"1px solid var(--gold)":"1px solid var(--border)", color:pct===p?"var(--gold)":"var(--muted)", borderRadius:6, padding:"6px", cursor:"pointer", fontSize:11, fontFamily:"'DM Mono',monospace" }}>{p}%</button>
            ))}
          </div>

          {/* Summary */}
          {[["Total", `$${parseFloat(total).toLocaleString(undefined,{maximumFractionDigits:2})}`],["Fee (0.1%)",`$${fee}`]].map(([l,v]) => (
            <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid var(--border)", fontSize:12 }}>
              <span style={{ color:"var(--muted)" }}>{l}</span>
              <span className="mono">{v}</span>
            </div>
          ))}

          <button onClick={async ()=>{ if(amount){
  addTradeToast && addTradeToast(`${side} order placed!`, `${amount} ${pair.replace("USDT","")} at ${fmtPrice(parseFloat(price))}`, side==="Buy"?"success":"info");
  if(user?.uid) await addTransaction(user.uid, { type:side, coin:pair.replace("USDT",""), amount:parseFloat(amount), price:parseFloat(price), total:parseFloat(total), fee:parseFloat(fee), status:"Completed", txid:"0x"+Math.random().toString(16).slice(2,14) });
  setAmount("");
}}} style={{ width:"100%", marginTop:16, padding:"13px", background: side==="Buy" ? "var(--green)" : "var(--red)", color:"#000", border:"none", borderRadius:8, cursor: amount?"pointer":"not-allowed", fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:14, transition:"all .2s", opacity:amount?1:0.6 }}>
            {side} BTC
          </button>
        </Card>

        {/* Open orders */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
            <span style={{ fontSize:12, color:"var(--muted)" }}>Open Orders</span>
          </div>
          <div style={{ fontSize:12, color:"var(--muted2)", textAlign:"center", padding:"12px 0" }}>No open orders</div>
        </Card>

        {/* Live trades feed */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={{ fontSize:12, color:"var(--muted)" }}>Live Trades</span>
            <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:10 }}>
              <div className="live-dot"/>
              <span style={{ color:"var(--muted)" }}>{pair}</span>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", fontSize:10, color:"var(--muted)", marginBottom:6 }}>
            <span>Price</span><span style={{textAlign:"center"}}>Amount</span><span style={{textAlign:"right"}}>Time</span>
          </div>
          <div style={{ maxHeight:180, overflowY:"auto" }}>
            {liveTrades.slice(0,20).map((t,i) => (
              <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", fontSize:11, fontFamily:"'DM Mono',monospace", padding:"3px 0", borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
                <span style={{ color:t.isBuy?"var(--green)":"var(--red)" }}>{t.price?.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                <span style={{ textAlign:"center", color:"var(--text)" }}>{t.amount?.toFixed(4)}</span>
                <span style={{ textAlign:"right", color:"var(--muted)" }}>{t.time}</span>
              </div>
            ))}
            {liveTrades.length === 0 && <div style={{ fontSize:11, color:"var(--muted2)", textAlign:"center", padding:"12px 0" }}>Connecting to trade feed…</div>}
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: WALLET
// ─────────────────────────────────────────────────────────────────────────────
const Wallet = ({ coins = COINS }) => {
  const [modal, setModal] = useState(null);
  const [activeAsset, setActiveAsset] = useState(null);
  const [copied, setCopied] = useState(false);
  const [withdrawAddr, setWithdrawAddr] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");

  const totalUSD = WALLET_ASSETS.reduce((a,w) => {
    const coin = coins.find(c=>c.sym===w.sym);
    return a + (coin ? coin.price * w.balance : w.balance);
  },0);

  const copyAddr = () => { setCopied(true); setTimeout(()=>setCopied(false),2000); };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Balance hero */}
      <Card style={{ background:"linear-gradient(135deg,#0e1118 60%,#1a1400)", border:"1px solid var(--gold)30", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:-40, right:-40, width:200, height:200, borderRadius:"50%", background:"radial-gradient(circle,rgba(240,165,0,0.1),transparent 70%)" }} />
        <div style={{ fontSize:11, color:"var(--muted)", textTransform:"uppercase", letterSpacing:1 }}>Total Balance</div>
        <div className="mono" style={{ fontSize:36, fontWeight:500, color:"var(--gold)", margin:"8px 0 4px" }}>${totalUSD.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
        <div style={{ fontSize:12, color:"var(--muted)" }}>Across {WALLET_ASSETS.length} assets</div>
      </Card>

      {/* Assets */}
      <Card style={{ padding:0, overflow:"hidden" }}>
        <div className="table-wrap">
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:500 }}>
          <thead>
            <tr style={{ borderBottom:"1px solid var(--border)" }}>
              {["Asset","Balance","USD Value","Actions"].map((h,i) => (
                <th key={h} style={{ padding:"13px 18px", textAlign: i<2?"left":"right", fontSize:10, color:"var(--muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WALLET_ASSETS.map(w => {
              const coin = COINS.find(c=>c.sym===w.sym);
              const usd  = coin ? coin.price * w.balance : w.balance;
              return (
                <tr key={w.sym} style={{ borderBottom:"1px solid var(--border)" }}>
                  <td style={{ padding:"14px 18px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <CoinIcon sym={w.sym} color={w.color} size={32} />
                      <div>
                        <div style={{ fontWeight:700, fontSize:13 }}>{w.sym}</div>
                        <div style={{ fontSize:11, color:"var(--muted)" }}>{w.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono" style={{ padding:"14px 18px", fontSize:13 }}>{w.balance.toLocaleString()}</td>
                  <td className="mono" style={{ padding:"14px 18px", fontSize:13, textAlign:"right" }}>${usd.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                  <td style={{ padding:"14px 18px", textAlign:"right" }}>
                    <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                      <GoldBtn style={{ padding:"6px 14px", fontSize:11 }} onClick={() => { setActiveAsset(w); setModal("deposit"); }}>Deposit</GoldBtn>
                      <GoldBtn outline style={{ padding:"6px 14px", fontSize:11 }} onClick={() => { setActiveAsset(w); setModal("withdraw"); }}>Withdraw</GoldBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      {/* Recent txns */}
      <Card>
        <div style={{ fontSize:13, color:"var(--muted)", marginBottom:14 }}>Recent Transactions</div>
        {TXNS.map((t,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid var(--border)" }}>
            <div style={{ width:36, height:36, borderRadius:8, background: t.type==="Deposit"||t.type==="Buy" ? "rgba(0,228,154,0.1)" : "rgba(255,77,109,0.1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>
              {t.type==="Deposit"||t.type==="Buy"?"⬇":"⬆"}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{t.type} {t.coin}</div>
              <div className="mono" style={{ fontSize:11, color:"var(--muted)" }}>{t.time}</div>
            </div>
            <div className="mono" style={{ fontSize:13 }}>{t.amount} {t.coin}</div>
            <Badge color="var(--green)">{t.status}</Badge>
          </div>
        ))}
      </Card>

      {/* MODALS */}
      {modal && (
        <div onClick={()=>setModal(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(6px)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, width:420, maxWidth:"90vw" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ fontWeight:800, fontSize:16 }}>{modal==="deposit"?"Deposit":"Withdraw"} {activeAsset?.sym}</div>
              <button onClick={()=>setModal(null)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:20 }}>✕</button>
            </div>

            {modal === "deposit" ? (
              <>
                <div style={{ background:"var(--bg3)", borderRadius:12, padding:20, textAlign:"center", marginBottom:16 }}>
                  {/* QR placeholder */}
                  <div style={{ width:120, height:120, margin:"0 auto 12px", background:"white", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <svg width="100" height="100" viewBox="0 0 100 100">
                      {[0,1,2,3,4,5,6].flatMap(r=>[0,1,2,3,4,5,6].map(c=>(
                        Math.random()>0.5 ? <rect key={`${r}${c}`} x={c*14} y={r*14} width={12} height={12} fill="#000" /> : null
                      )))}
                    </svg>
                  </div>
                  <div className="mono" style={{ fontSize:11, color:"var(--muted)", wordBreak:"break-all" }}>0x3fA2b1C8d9E4f7A0b2C3d5E6f8A1b3C4d</div>
                  <button onClick={copyAddr} style={{ marginTop:10, background:"var(--goldDim)", border:"1px solid var(--gold)40", color:"var(--gold)", borderRadius:8, padding:"8px 20px", cursor:"pointer", fontSize:12, fontFamily:"'Syne',sans-serif" }}>
                    {copied ? "✓ Copied!" : "Copy Address"}
                  </button>
                </div>
                <div style={{ fontSize:12, color:"var(--muted)", background:"rgba(255,165,0,0.08)", borderRadius:8, padding:"10px 14px", border:"1px solid rgba(240,165,0,0.2)" }}>
                  ⚠ Min deposit: 0.001 {activeAsset?.sym}. Only send on the correct network.
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>Destination Address</div>
                  <input value={withdrawAddr} onChange={e=>setWithdrawAddr(e.target.value)} placeholder="0x..." style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"11px 14px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12, outline:"none" }} />
                </div>
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>Amount</div>
                  <div style={{ position:"relative" }}>
                    <input value={withdrawAmt} onChange={e=>setWithdrawAmt(e.target.value)} placeholder="0.00" style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"11px 60px 11px 14px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12, outline:"none" }} />
                    <button style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"var(--gold)", cursor:"pointer", fontSize:11, fontFamily:"'Syne',sans-serif", fontWeight:700 }}>MAX</button>
                  </div>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"8px 0", borderBottom:"1px solid var(--border)", marginBottom:16 }}>
                  <span style={{ color:"var(--muted)" }}>Network Fee</span>
                  <span className="mono">~0.0003 {activeAsset?.sym}</span>
                </div>
                <GoldBtn style={{ width:"100%" }} onClick={()=>setModal(null)}>Confirm Withdrawal</GoldBtn>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
const Settings = () => {
  const [tab, setTab] = useState("Profile");
  const [twoFA, setTwoFA] = useState(false);
  const [notifs, setNotifs] = useState({ deposits:true, trades:true, priceAlerts:false, security:true });

  return (
    <div style={{ display:"flex", gap:20 }}>
      <style>{".settings-sidebar{display:flex!important;flex-direction:column;gap:2px;width:180px;flex-shrink:0}@media(max-width:768px){.settings-sidebar{display:none!important}}"}</style>
      {/* Sidebar */}
      <div style={{ display:"flex", flexDirection:"column", gap:2, width:180, flexShrink:0 }}>
        {["Profile","Security","Notifications","API Keys","Verification"].map(t => (
          <button key={t} onClick={()=>setTab(t)} style={{
            background: tab===t ? "var(--goldDim)" : "none",
            border: tab===t ? "1px solid var(--gold)30" : "1px solid transparent",
            color: tab===t ? "var(--gold)" : "var(--muted)",
            borderRadius:8, padding:"10px 14px", cursor:"pointer",
            fontFamily:"'Syne',sans-serif", fontWeight: tab===t ? 700 : 500,
            fontSize:13, textAlign:"left", transition:"all .2s"
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:14 }}>
        {tab === "Profile" && (
          <Card>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:20 }}>Profile Settings</div>
            <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24 }}>
              <div style={{ width:64, height:64, borderRadius:"50%", background:"linear-gradient(135deg,var(--gold),#f7931a)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, fontWeight:800, color:"#000" }}>A</div>
              <GoldBtn outline>Change Avatar</GoldBtn>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              {[["Full Name","Alex Morgan"],["Email","alex@example.com"],["Phone","+1 (555) 0192"],["Country","United States"],["Timezone","UTC-5 Eastern"],["Currency","USD"]].map(([label,val]) => (
                <div key={label}>
                  <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:0.8 }}>{label}</div>
                  <input defaultValue={val} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:13, outline:"none" }} />
                </div>
              ))}
            </div>
            <GoldBtn style={{ marginTop:20 }}>Save Changes</GoldBtn>
          </Card>
        )}

        {tab === "Security" && (
          <Card>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:20 }}>Security Settings</div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 0", borderBottom:"1px solid var(--border)" }}>
              <div>
                <div style={{ fontWeight:600, fontSize:13 }}>Two-Factor Authentication</div>
                <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>Secure your account with TOTP 2FA</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                {twoFA && <span style={{ fontSize:11, color:"var(--green)" }}>✓ Active</span>}
                <div onClick={()=>setTwoFA(!twoFA)} style={{ width:44, height:24, borderRadius:12, background:twoFA?"var(--green)":"var(--bg4)", cursor:"pointer", position:"relative", transition:"background .2s" }}>
                  <div style={{ position:"absolute", top:2, left:twoFA?22:2, width:20, height:20, borderRadius:"50%", background:"white", transition:"left .2s" }} />
                </div>
              </div>
            </div>
            {[["Change Password","Update your login password"],["Active Sessions","Manage logged-in devices"],["Login History","Review recent sign-ins"]].map(([t,d]) => (
              <div key={t} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 0", borderBottom:"1px solid var(--border)" }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:13 }}>{t}</div>
                  <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>{d}</div>
                </div>
                <GoldBtn outline style={{ padding:"6px 14px", fontSize:11 }}>Manage</GoldBtn>
              </div>
            ))}
          </Card>
        )}

        {tab === "Notifications" && (
          <Card>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:20 }}>Notification Preferences</div>
            {[["deposits","Deposits & Withdrawals"],["trades","Trade Confirmations"],["priceAlerts","Price Alerts"],["security","Security Alerts"]].map(([key,label]) => (
              <div key={key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 0", borderBottom:"1px solid var(--border)" }}>
                <div style={{ fontWeight:600, fontSize:13 }}>{label}</div>
                <div onClick={()=>setNotifs(n=>({...n,[key]:!n[key]}))} style={{ width:44, height:24, borderRadius:12, background:notifs[key]?"var(--green)":"var(--bg4)", cursor:"pointer", position:"relative", transition:"background .2s" }}>
                  <div style={{ position:"absolute", top:2, left:notifs[key]?22:2, width:20, height:20, borderRadius:"50%", background:"white", transition:"left .2s" }} />
                </div>
              </div>
            ))}
          </Card>
        )}

        {tab === "API Keys" && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>API Keys</div>
              <GoldBtn>+ Create Key</GoldBtn>
            </div>
            <div style={{ background:"var(--bg3)", borderRadius:10, padding:16, marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:13 }}>Main Trading Bot</div>
                  <div className="mono" style={{ fontSize:11, color:"var(--muted)", marginTop:4 }}>sk_live_••••••••••••••••••••xK92</div>
                </div>
                <Badge color="var(--green)">Active</Badge>
              </div>
              <div style={{ display:"flex", gap:8, marginTop:10 }}>
                {["Read","Trade"].map(p => <Badge key={p} color="var(--gold)">{p}</Badge>)}
              </div>
              <div style={{ fontSize:11, color:"var(--muted)", marginTop:10 }}>Last used: 2 minutes ago</div>
            </div>
            <div style={{ fontSize:12, color:"var(--muted)", background:"rgba(255,165,0,0.06)", borderRadius:8, padding:"10px 14px", border:"1px solid rgba(240,165,0,0.15)" }}>
              ⚠ Never share your API keys. Enable withdrawal restrictions for extra security.
            </div>
          </Card>
        )}

        {tab === "Verification" && (
          <Card>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:20 }}>KYC Verification</div>
            {[
              { tier:"Basic",    desc:"Email verified", status:"Completed", color:"var(--green)" },
              { tier:"Advanced", desc:"Gov ID + Selfie", status:"Completed", color:"var(--green)" },
              { tier:"Pro",      desc:"Proof of address",status:"Pending",  color:"var(--gold)" },
            ].map(v => (
              <div key={v.tier} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 0", borderBottom:"1px solid var(--border)" }}>
                <div style={{ width:36, height:36, borderRadius:8, background:`${v.color}20`, border:`1px solid ${v.color}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>
                  {v.status==="Completed" ? "✓" : "⏳"}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600, fontSize:13 }}>Tier {v.tier}</div>
                  <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>{v.desc}</div>
                </div>
                <Badge color={v.color}>{v.status}</Badge>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────
const genHeatmap = () => {
  const cells = [];
  for (let w = 0; w < 26; w++) {
    for (let d = 0; d < 7; d++) {
      const val = (Math.random() - 0.42) * 4;
      cells.push({ w, d, val: parseFloat(val.toFixed(2)) });
    }
  }
  return cells;
};
const heatmapData = genHeatmap();

const DAYS_LABEL = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const genBenchmark = () => {
  const pts = []; let port = 100, btc = 100;
  for (let i = 90; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    port = Math.max(70, port + (Math.random() - 0.43) * 3);
    btc  = Math.max(60, btc  + (Math.random() - 0.45) * 3.5);
    pts.push({ date: d.toLocaleDateString("en",{month:"short",day:"numeric"}), portfolio: parseFloat(port.toFixed(1)), btc: parseFloat(btc.toFixed(1)) });
  }
  return pts;
};
const benchmarkData = genBenchmark();

const Analytics = ({ coins = COINS }) => {
  const [rangeIdx, setRangeIdx] = useState(90);
  const slice = benchmarkData.slice(-rangeIdx);

  // Real financial math with mathjs
  const returns = useMemo(() => {
    const vals = benchmarkData.slice(-60).map(d => d.portfolio);
    const rets = vals.slice(1).map((v,i) => (v - vals[i]) / vals[i]);
    return rets;
  }, []);

  const sharpe = useMemo(() => {
    if (returns.length < 2) return 0;
    const mean = math.mean(returns);
    const std  = math.std(returns);
    return std > 0 ? ((mean / std) * Math.sqrt(252)).toFixed(2) : "0.00";
  }, [returns]);

  const volatility = useMemo(() => {
    if (returns.length < 2) return 0;
    return (math.std(returns) * Math.sqrt(252) * 100).toFixed(1);
  }, [returns]);

  const maxDrawdown = useMemo(() => {
    const vals = benchmarkData.map(d=>d.portfolio);
    let peak = vals[0], maxDD = 0;
    for (const v of vals) { if (v > peak) peak = v; maxDD = Math.min(maxDD, (v-peak)/peak); }
    return (maxDD * 100).toFixed(1);
  }, []);

  const livePortfolio = HOLDINGS.reduce((a,h) => a + (coins.find(c=>c.id===h.id)||{price:h.avgBuy}).price * h.amount, 0);
  const costBasis     = HOLDINGS.reduce((a,h) => a + h.avgBuy * h.amount, 0);
  const totalReturn   = ((livePortfolio - costBasis) / costBasis * 100).toFixed(1);

  const stats = [
    { label:"Win Rate",     val:"64.3%",                    sub:"of trades profitable",    color:"var(--green)" },
    { label:"Sharpe Ratio", val:sharpe,                     sub:"risk-adjusted (annualized)",color:"var(--gold)"  },
    { label:"Volatility",   val:`${volatility}%`,           sub:"annualized std deviation", color:"var(--text)"  },
    { label:"Max Drawdown", val:`${maxDrawdown}%`,          sub:"worst peak-to-trough",    color:"var(--red)"   },
    { label:"Total Return", val:`${totalReturn>=0?"+":""}${totalReturn}%`, sub:"vs cost basis", color:totalReturn>=0?"var(--green)":"var(--red)" },
    { label:"Portfolio",    val:`$${Math.round(livePortfolio).toLocaleString()}`, sub:"current value", color:"var(--gold)" },
  ];

  const assetReturns = HOLDINGS.map(h => {
    const coin = coins.find(c=>c.id===h.id);
    const ret = ((coin.price - h.avgBuy)/h.avgBuy*100);
    return { sym: h.sym, ret: parseFloat(ret.toFixed(1)), color: h.color };
  }).sort((a,b) => b.ret - a.ret);

  const heatCell = (val) => {
    if (val > 2)  return "#00e49a";
    if (val > 0)  return "#00a06a";
    if (val > -2) return "#c0392b";
    return "#ff4d6d";
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Stats grid */}
      <div className="rg-6" style={{ gap:12 }}>
        {stats.map((s,i) => (
          <Card key={i} className={`fade-up-${(i%4)+1}`} style={{ padding:"16px 14px" }}>
            <div style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>{s.label}</div>
            <div className="mono" style={{ fontSize:18, fontWeight:500, color:s.color }}>{s.val}</div>
            <div style={{ fontSize:10, color:"var(--muted)", marginTop:4 }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      {/* Benchmark chart */}
      <Card className="fade-up-2">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:14 }}>Portfolio vs BTC Benchmark</div>
            <div style={{ fontSize:11, color:"var(--muted)", marginTop:2 }}>Indexed to 100 at start of period</div>
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {[[30,"1M"],[60,"2M"],[90,"3M"]].map(([n,l]) => (
              <button key={l} onClick={()=>setRangeIdx(n)} style={{ background:rangeIdx===n?"var(--goldDim)":"var(--bg3)", border:rangeIdx===n?"1px solid var(--gold)":"1px solid var(--border)", color:rangeIdx===n?"var(--gold)":"var(--muted)", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11, fontFamily:"'DM Mono',monospace" }}>{l}</button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={window.innerWidth < 768 ? 160 : 220}>
          <LineChart data={slice}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{fill:"var(--muted)",fontSize:9}} axisLine={false} tickLine={false} interval={Math.floor(slice.length/8)} />
            <YAxis domain={["auto","auto"]} tick={{fill:"var(--muted)",fontSize:9}} axisLine={false} tickLine={false} orientation="right" />
            <Tooltip contentStyle={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,fontFamily:"'DM Mono',monospace",fontSize:11}} />
            <Legend wrapperStyle={{fontSize:11,color:"var(--muted)"}} />
            <Line dataKey="portfolio" name="My Portfolio" stroke="var(--gold)" strokeWidth={2} dot={false} />
            <Line dataKey="btc" name="Bitcoin" stroke="var(--muted)" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="rg-2" style={{ gap:16 }}>
        {/* Asset return bars */}
        <Card>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Asset Performance</div>
          {assetReturns.map(a => (
            <div key={a.sym} style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:12 }}>
                <span style={{ color:"var(--text)", fontWeight:600 }}>{a.sym}</span>
                <span className="mono" style={{ color:a.ret>=0?"var(--green)":"var(--red)" }}>{a.ret>=0?"+":""}{a.ret}%</span>
              </div>
              <div style={{ height:6, background:"var(--bg4)", borderRadius:4, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${Math.min(100,Math.abs(a.ret)/50*100)}%`, background:a.ret>=0?`linear-gradient(90deg,var(--green),${a.color})`:`linear-gradient(90deg,var(--red),#c0392b)`, borderRadius:4, transition:"width .6s ease" }} />
              </div>
            </div>
          ))}
        </Card>

        {/* P&L Heatmap */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontWeight:700, fontSize:14 }}>Daily P&L Heatmap</div>
            <div style={{ display:"flex", gap:6, fontSize:10, color:"var(--muted)", alignItems:"center" }}>
              <div style={{ width:10, height:10, borderRadius:2, background:"var(--red)" }} /> Loss
              <div style={{ width:10, height:10, borderRadius:2, background:"var(--green)", marginLeft:6 }} /> Gain
            </div>
          </div>
          <div style={{ display:"flex", gap:3 }}>
            <div style={{ display:"flex", flexDirection:"column", gap:3, marginRight:4 }}>
              {DAYS_LABEL.map(d => (
                <div key={d} style={{ height:12, fontSize:8, color:"var(--muted)", lineHeight:"12px" }}>{d}</div>
              ))}
            </div>
            {Array.from({length:26},(_,w) => (
              <div key={w} style={{ display:"flex", flexDirection:"column", gap:3 }}>
                {Array.from({length:7},(_,d) => {
                  const cell = heatmapData.find(c=>c.w===w&&c.d===d);
                  return (
                    <div key={d} title={`${cell?.val>=0?"+":""}${cell?.val}%`} style={{ width:12, height:12, borderRadius:2, background:cell?heatCell(cell.val):"var(--bg4)", cursor:"default", transition:"transform .1s" }}
                      onMouseEnter={e=>e.currentTarget.style.transform="scale(1.4)"}
                      onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginTop:16 }}>
            {[["Total P&L","+$18,432"], ["Realized","+$12,210"], ["Tax Year","2025"]].map(([l,v]) => (
              <div key={l} style={{ background:"var(--bg3)", borderRadius:8, padding:"10px 12px" }}>
                <div style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.8 }}>{l}</div>
                <div className="mono" style={{ fontSize:14, color:"var(--green)", marginTop:4 }}>{v}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: PRICE ALERTS
// ─────────────────────────────────────────────────────────────────────────────
const playAlertSound = async (type = "trigger") => {
  try {
    await Tone.start();
    if (type === "trigger") {
      const synth = new Tone.Synth({ oscillator:{type:"triangle"}, envelope:{attack:0.01,decay:0.1,sustain:0.3,release:0.5} }).toDestination();
      synth.triggerAttackRelease("C5", "8n");
      setTimeout(() => synth.triggerAttackRelease("E5","8n"), 150);
      setTimeout(() => synth.triggerAttackRelease("G5","4n"), 300);
    } else {
      const synth = new Tone.Synth({ oscillator:{type:"sine"}, envelope:{attack:0.02,decay:0.2,sustain:0.1,release:0.3} }).toDestination();
      synth.triggerAttackRelease("A4", "8n");
    }
  } catch(e) {}
};

const Alerts = ({ coins = COINS }) => {
  const { user } = useAuth();
  const [triggeredIds, setTriggeredIds] = useState(new Set());
  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);

  // Subscribe to Firestore alerts
  useEffect(() => {
    if (!user?.uid) return;
    setAlertsLoading(true);
    const unsub = watchAlerts(user.uid, (data) => {
      setAlerts(data);
      setAlertsLoading(false);
    });
    return unsub;
  }, [user?.uid]);

  // Check alerts against live prices every 2s
  useEffect(() => {
    const id = setInterval(() => {
      alerts.forEach(a => {
        if (!a.active || triggeredIds.has(a.id)) return;
        const coin = coins.find(c=>c.sym===a.sym);
        if (!coin) return;
        const fired = a.cond==="above" ? coin.price >= a.target : coin.price <= a.target;
        if (fired) {
          playAlertSound("trigger");
          setTriggeredIds(s => new Set([...s, a.id]));
          if (user?.uid) fbUpdateAlert(user.uid, a.id, { active:false, firedAt: new Date().toISOString() });
        }
      });
    }, 2000);
    return () => clearInterval(id);
  }, [coins, triggeredIds, alerts, user?.uid]);
  const [showForm, setShowForm] = useState(false);
  const [newAlert, setNewAlert] = useState({ sym:"BTC", cond:"above", target:"" });

  const triggered = [
    { sym:"BTC", cond:"above", target:65000, at:"May 10, 14:22", priceThen:"$65,240" },
    { sym:"ETH", cond:"below", target:3800,  at:"May 8,  09:11",  priceThen:"$3,791"  },
  ];

  const getProgress = (a) => {
    const coin = coins.find(c=>c.sym===a.sym);
    if (!coin) return 0;
    const p = coin.price;
    if (a.cond==="above") return Math.min(100, (p/a.target)*100);
    return Math.min(100, (a.target/p)*100);
  };

  const addAlert = () => {
    if (!newAlert.target) return;
    const coin = coins.find(c=>c.sym===newAlert.sym);
    const newEntry = { sym:newAlert.sym, name:coin?.name||newAlert.sym, color:coin?.color||"#f0a500", cond:newAlert.cond, target:parseFloat(newAlert.target), active:true };
    if (user?.uid) fbAddAlert(user.uid, newEntry);
    else setAlerts(prev => [...prev, { ...newEntry, id: Date.now() }]);
    playAlertSound("set");
    setShowForm(false);
    setNewAlert({ sym:"BTC", cond:"above", target:"" });
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontWeight:800, fontSize:16 }}>Price Alerts</div>
          <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>{alerts.filter(a=>a.active).length} active alerts</div>
        </div>
        <GoldBtn onClick={()=>setShowForm(!showForm)}>+ Create Alert</GoldBtn>
      </div>

      {/* Create form */}
      {showForm && (
        <Card style={{ border:"1px solid var(--gold)40", background:"linear-gradient(135deg,var(--bg2),#100e00)" }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>New Price Alert</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:12, alignItems:"flex-end" }}>
            <div>
              <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>Coin</div>
              <select value={newAlert.sym} onChange={e=>setNewAlert(n=>({...n,sym:e.target.value}))} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:13, outline:"none" }}>
                {coins.map(c=><option key={c.sym} value={c.sym}>{c.name} ({c.sym})</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>Condition</div>
              <select value={newAlert.cond} onChange={e=>setNewAlert(n=>({...n,cond:e.target.value}))} style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:13, outline:"none" }}>
                <option value="above">Price goes above</option>
                <option value="below">Price goes below</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>Target Price (USD)</div>
              <input value={newAlert.target} onChange={e=>setNewAlert(n=>({...n,target:e.target.value}))} placeholder="e.g. 75000" style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 12px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none" }} />
            </div>
            <GoldBtn onClick={addAlert}>Set Alert</GoldBtn>
          </div>
        </Card>
      )}

      {/* Active alerts */}
      <Card style={{ padding:0, overflow:"hidden" }}>
        <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--border)", fontSize:13, color:"var(--muted)" }}>Active Alerts</div>
        {alerts.map(a => {
          const coin = coins.find(c=>c.sym===a.sym);
          const prog = getProgress(a);
          const diff = coin ? ((a.target - coin.price)/coin.price*100) : 0;
          return (
            <div key={a.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 20px", borderBottom:"1px solid var(--border)", opacity:a.active?1:0.45 }}>
              <CoinIcon sym={a.sym} color={a.color} size={32} />
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
                  <span style={{ fontWeight:700, fontSize:13 }}>{a.name}</span>
                  <Badge color={a.cond==="above"?"var(--green)":"var(--red)"}>{a.cond === "above" ? "↑ Above" : "↓ Below"} {fmtPrice(a.target)}</Badge>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ flex:1, height:4, background:"var(--bg4)", borderRadius:4 }}>
                    <div style={{ height:"100%", width:`${prog}%`, background:a.cond==="above"?"var(--green)":"var(--red)", borderRadius:4, transition:"width .6s" }} />
                  </div>
                  <span className="mono" style={{ fontSize:11, color:"var(--muted)", whiteSpace:"nowrap" }}>{Math.abs(diff).toFixed(1)}% away</span>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div className="mono" style={{ fontSize:13 }}>Current: {fmtPrice(coin?.price||0)}</div>
                <div style={{ fontSize:11, color:"var(--muted)", marginTop:2 }}>Target: {fmtPrice(a.target)}</div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={()=>{ if(user?.uid) fbUpdateAlert(user.uid, a.id, {active:!a.active}); else setAlerts(al=>al.map(x=>x.id===a.id?{...x,active:!x.active}:x)); }} style={{ background:a.active?"var(--goldDim)":"var(--bg3)", border:`1px solid ${a.active?"var(--gold)":"var(--border)"}`, color:a.active?"var(--gold)":"var(--muted)", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:11, fontFamily:"'Syne',sans-serif" }}>{a.active?"On":"Off"}</button>
                <button onClick={()=>{ if(user?.uid) fbDeleteAlert(user.uid, a.id); else setAlerts(al=>al.filter(x=>x.id!==a.id)); }} style={{ background:"rgba(255,77,109,0.1)", border:"1px solid rgba(255,77,109,0.3)", color:"var(--red)", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:11 }}>✕</button>
              </div>
            </div>
          );
        })}
      </Card>

      {/* Triggered history */}
      <Card>
        <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Alert History</div>
        {triggered.map((t,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid var(--border)" }}>
            <div style={{ width:32, height:32, borderRadius:8, background:"rgba(0,228,154,0.1)", border:"1px solid rgba(0,228,154,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🔔</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{t.sym} {t.cond} {fmtPrice(t.target)}</div>
              <div className="mono" style={{ fontSize:11, color:"var(--muted)" }}>{t.at} · triggered at {t.priceThen}</div>
            </div>
            <Badge color="var(--green)">Triggered</Badge>
          </div>
        ))}
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AI ASSISTANT PANEL (Claude-powered)
// ─────────────────────────────────────────────────────────────────────────────
const SUGGESTED = [
  "Analyze my portfolio risk",
  "Which coin has the best momentum?",
  "Suggest a rebalancing strategy",
  "Explain today's BTC move",
];

const AIAssistant = ({ onClose }) => {
  const [msgs, setMsgs] = useState([
    { role:"assistant", text:"Hello! I'm your Aurum AI advisor. Ask me anything about your portfolio, market conditions, or trading strategies." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const portfolioContext = `
User portfolio: BTC 0.842 (avg $52,100), ETH 5.34 (avg $2,980), SOL 48.2 (avg $148), AVAX 120 (avg $38), LINK 340 (avg $14.2).
Current prices: BTC $68,420, ETH $3,812, SOL $182, AVAX $42, LINK $18.92.
Total portfolio value: $87,432. Total invested: $72,100. Unrealized P&L: +$15,332 (+21.3%).
  `.trim();

  const send = async (text) => {
    const q = text || input.trim();
    if (!q || loading) return;
    setInput("");
    setMsgs(m => [...m, { role:"user", text:q }]);
    setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          system:`You are Aurum, a professional crypto investment advisor embedded in a trading platform. Be concise, insightful, and data-driven. Always refer to the user's actual portfolio data when relevant. Never give financial advice — frame as analysis and education. Here is the user's portfolio context:\n\n${portfolioContext}`,
          messages:[
            ...msgs.filter(m=>m.role!=="assistant"||msgs.indexOf(m)>0).map(m=>({ role:m.role, content:m.text })),
            { role:"user", content:q }
          ]
        })
      });
      const data = await res.json();
      const reply = data.content?.map(b=>b.text||"").join("") || "Sorry, I couldn't process that.";
      setMsgs(m => [...m, { role:"assistant", text:reply }]);
    } catch(e) {
      setMsgs(m => [...m, { role:"assistant", text:"Connection error. Please try again." }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", right:0, top:0, bottom:0, width:380, background:"var(--bg2)", borderLeft:"1px solid var(--border)", display:"flex", flexDirection:"column", zIndex:200, boxShadow:"-20px 0 60px rgba(0,0,0,0.5)" }}>
      {/* Header */}
      <div style={{ padding:"18px 20px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#f0a500,#ffc333)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>✦</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:800, fontSize:14 }}>Aurum AI Advisor</div>
          <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--green)", marginTop:1 }}>
            <div className="live-dot" /> Powered by Claude
          </div>
        </div>
        <button onClick={onClose} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--muted)", width:30, height:30, borderRadius:8, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
      </div>

      {/* Messages */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px" }}>
        {msgs.map((m,i) => (
          <div key={i} style={{ display:"flex", gap:10, marginBottom:16, flexDirection:m.role==="user"?"row-reverse":"row" }}>
            <div style={{ width:28, height:28, borderRadius:8, flexShrink:0, background:m.role==="user"?"linear-gradient(135deg,#f0a500,#ffc333)":"var(--bg4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:m.role==="user"?"#000":"var(--gold)" }}>
              {m.role==="user" ? "A" : "✦"}
            </div>
            <div style={{ maxWidth:"80%", background:m.role==="user"?"var(--goldDim)":"var(--bg3)", border:`1px solid ${m.role==="user"?"rgba(240,165,0,0.3)":"var(--border)"}`, borderRadius:m.role==="user"?"12px 4px 12px 12px":"4px 12px 12px 12px", padding:"10px 14px", fontSize:12.5, lineHeight:1.65, color:"var(--text)", whiteSpace:"pre-wrap" }}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display:"flex", gap:10, marginBottom:16 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:"var(--bg4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"var(--gold)" }}>✦</div>
            <div style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:"4px 12px 12px 12px", padding:"14px 18px" }}>
              <div style={{ display:"flex", gap:5 }}>
                {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"var(--gold)", animation:`pulse 1.2s ${i*0.2}s infinite` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {msgs.length < 3 && (
        <div style={{ padding:"0 16px 10px" }}>
          <div style={{ fontSize:10, color:"var(--muted)", marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Suggested</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {SUGGESTED.map(s => (
              <button key={s} onClick={()=>send(s)} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--muted)", borderRadius:20, padding:"5px 12px", cursor:"pointer", fontSize:11, fontFamily:"'Syne',sans-serif", transition:"all .2s" }}
                onMouseEnter={e=>{e.currentTarget.style.color="var(--gold)";e.currentTarget.style.borderColor="var(--gold)40";}}
                onMouseLeave={e=>{e.currentTarget.style.color="var(--muted)";e.currentTarget.style.borderColor="var(--border)";}}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding:"10px 14px 16px", borderTop:"1px solid var(--border)" }}>
        <div style={{ display:"flex", gap:8, background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:12, padding:"8px 8px 8px 14px", alignItems:"flex-end" }}>
          <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Ask about your portfolio…" rows={1} style={{ flex:1, background:"none", border:"none", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:13, resize:"none", outline:"none", lineHeight:1.5, maxHeight:100, overflowY:"auto" }} />
          <button onClick={()=>send()} disabled={loading||!input.trim()} style={{ width:34, height:34, borderRadius:8, background:input.trim()?"linear-gradient(135deg,#f0a500,#ffc333)":"var(--bg4)", border:"none", cursor:input.trim()?"pointer":"default", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, transition:"all .2s", flexShrink:0 }}>→</button>
        </div>
        <div style={{ fontSize:10, color:"var(--muted2)", textAlign:"center", marginTop:8 }}>Powered by Claude · Not financial advice</div>
      </div>

      {/* Correlation Matrix */}
      <Card className="fade-up-4">
        <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>Correlation Matrix
          <span style={{ fontSize:11, color:"var(--muted)", fontWeight:400, marginLeft:8 }}>30-day price correlation</span>
        </div>
        {(() => {
          const symbols = HOLDINGS.map(h=>h.sym);
          const priceData = HOLDINGS.map(h => {
            const base = h.avgBuy;
            return Array.from({length:30},(_,i) => base * (1 + (Math.sin(i*0.4+(h.id.charCodeAt(0)*0.3)) * 0.08) + (Math.random()-0.5)*0.04));
          });
          const corr = (a,b) => {
            try {
              const meanA = _.mean(a), meanB = _.mean(b);
              const num = _.sum(a.map((v,i)=>(v-meanA)*(b[i]-meanB)));
              const den = Math.sqrt(_.sum(a.map(v=>(v-meanA)**2)) * _.sum(b.map(v=>(v-meanB)**2)));
              return den > 0 ? parseFloat((num/den).toFixed(2)) : 1;
            } catch(e) { return 0; }
          };
          const matrix = priceData.map(a => priceData.map(b => corr(a,b)));
          const corrColor = v => v >= 0.7 ? "#00e49a" : v >= 0.3 ? "#4a9" : v >= 0 ? "#888" : v >= -0.3 ? "#d97" : "#ff4d6d";

          return (
            <div style={{ overflowX:"auto" }}>
              <table style={{ borderCollapse:"collapse", fontSize:11 }}>
                <thead>
                  <tr>
                    <th style={{ padding:"6px 10px", color:"var(--muted)" }}></th>
                    {symbols.map(s => <th key={s} style={{ padding:"6px 10px", color:"var(--muted)", textAlign:"center", fontFamily:"'DM Mono',monospace" }}>{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row,i) => (
                    <tr key={i}>
                      <td style={{ padding:"6px 10px", color:"var(--muted)", fontFamily:"'DM Mono',monospace", fontWeight:600 }}>{symbols[i]}</td>
                      {row.map((v,j) => (
                        <td key={j} style={{ padding:"6px 10px", textAlign:"center", fontFamily:"'DM Mono',monospace", background:i===j?"var(--goldDim)":`${corrColor(v)}15`, color:i===j?"var(--gold)":corrColor(v), fontWeight:i===j?700:400, borderRadius:4 }}>
                          {i===j?"1.00":v.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: TRANSACTION HISTORY
// ─────────────────────────────────────────────────────────────────────────────
const genHistory = () => {
  const types  = ["Buy","Sell","Deposit","Withdrawal","Swap"];
  const coins  = COINS;
  const rows   = [];
  let id = 1000;
  for (let i = 0; i < 40; i++) {
    const type  = types[Math.floor(Math.random() * types.length)];
    const coin  = coins[Math.floor(Math.random() * coins.length)];
    const d     = new Date(); d.setDate(d.getDate() - i * 2); d.setHours(Math.floor(Math.random()*24));
    const amt   = parseFloat((Math.random() * 5 + 0.01).toFixed(4));
    const price = coin.price * (0.92 + Math.random() * 0.16);
    const fee   = parseFloat((price * amt * 0.001).toFixed(2));
    const statuses = ["Completed","Completed","Completed","Pending","Failed"];
    rows.push({
      id: id++,
      type, coin: coin.sym, coinColor: coin.color, coinName: coin.name,
      amount: amt, price: parseFloat(price.toFixed(2)),
      total: parseFloat((amt * price).toFixed(2)), fee,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      date: d,
      txid: "0x" + Math.random().toString(16).slice(2,12) + "…"
    });
  }
  return rows.sort((a,b) => b.date - a.date);
};
const ALL_HISTORY = genHistory();

const History = () => {
  const [filter, setFilter]   = useState("All");
  const [coinF,  setCoinF]    = useState("All");
  const [statusF,setStatusF]  = useState("All");
  const [search, setSearch]   = useState("");
  const [page,   setPage2]    = useState(1);
  const PER_PAGE = 12;

  const types   = ["All","Buy","Sell","Deposit","Withdrawal","Swap"];
  const statuses = ["All","Completed","Pending","Failed"];
  const coinOpts = ["All",...[...new Set(ALL_HISTORY.map(h=>h.coin))]];

  const filtered = ALL_HISTORY.filter(h => {
    if (filter   !== "All" && h.type   !== filter)   return false;
    if (coinF    !== "All" && h.coin   !== coinF)    return false;
    if (statusF  !== "All" && h.status !== statusF)  return false;
    if (search && !h.coin.toLowerCase().includes(search.toLowerCase()) && !h.coinName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const pages    = Math.ceil(filtered.length / PER_PAGE);
  const slice    = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE);

  const totalIn  = filtered.filter(h=>h.type==="Buy"||h.type==="Deposit").reduce((a,h)=>a+h.total,0);
  const totalOut = filtered.filter(h=>h.type==="Sell"||h.type==="Withdrawal").reduce((a,h)=>a+h.total,0);
  const totalFee = filtered.reduce((a,h)=>a+h.fee,0);

  const statusColor = s => s==="Completed"?"var(--green)":s==="Pending"?"var(--gold)":"var(--red)";
  const typeIcon    = t => ({Buy:"↓",Sell:"↑",Deposit:"⬇",Withdrawal:"⬆",Swap:"⇄"}[t]||"·");
  const typeBg      = t => (t==="Buy"||t==="Deposit")?"rgba(0,228,154,0.1)":(t==="Sell"||t==="Withdrawal")?"rgba(255,77,109,0.1)":"rgba(240,165,0,0.1)";
  const typeColor   = t => (t==="Buy"||t==="Deposit")?"var(--green)":(t==="Sell"||t==="Withdrawal")?"var(--red)":"var(--gold)";

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Summary strip */}
      <div className="rg-4" style={{ gap:12 }}>
        {[
          { label:"Total Transactions", val:filtered.length,                          color:"var(--text)"  },
          { label:"Total In",           val:`$${totalIn.toLocaleString(undefined,{maximumFractionDigits:0})}`,  color:"var(--green)" },
          { label:"Total Out",          val:`$${totalOut.toLocaleString(undefined,{maximumFractionDigits:0})}`, color:"var(--red)"   },
          { label:"Fees Paid",          val:`$${totalFee.toFixed(2)}`,                color:"var(--muted)" },
        ].map((s,i) => (
          <Card key={i}>
            <div style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>{s.label}</div>
            <div className="mono" style={{ fontSize:20, color:s.color, fontWeight:500 }}>{s.val}</div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card style={{ padding:"14px 18px" }}>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", fontSize:12 }}>🔍</span>
            <input value={search} onChange={e=>{setSearch(e.target.value);setPage2(1);}} placeholder="Search coin…"
              style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"8px 10px 8px 30px", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:12, outline:"none", width:160 }} />
          </div>
          <div style={{ display:"flex", gap:4 }}>
            {types.map(t=>(
              <button key={t} onClick={()=>{setFilter(t);setPage2(1);}} style={{ background:filter===t?"var(--goldDim)":"var(--bg3)", border:filter===t?"1px solid var(--gold)":"1px solid var(--border)", color:filter===t?"var(--gold)":"var(--muted)", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:11, fontFamily:"'Syne',sans-serif", fontWeight:filter===t?700:500 }}>{t}</button>
            ))}
          </div>
          <select value={coinF} onChange={e=>{setCoinF(e.target.value);setPage2(1);}} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"7px 12px", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:12, outline:"none" }}>
            {coinOpts.map(c=><option key={c} value={c}>{c==="All"?"All Coins":c}</option>)}
          </select>
          <select value={statusF} onChange={e=>{setStatusF(e.target.value);setPage2(1);}} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"7px 12px", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:12, outline:"none" }}>
            {statuses.map(s=><option key={s} value={s}>{s==="All"?"All Statuses":s}</option>)}
          </select>
          <button onClick={() => {
            const csvData = filtered.map(h => ({
              Date: h.date.toLocaleDateString(), Time: h.date.toLocaleTimeString(),
              Type: h.type, Coin: h.coin, Amount: h.amount,
              Price_USD: h.price, Total_USD: h.total, Fee_USD: h.fee, Status: h.status, TxID: h.txid
            }));
            const csv = Papa.unparse(csvData);
            const blob = new Blob([csv], {type:"text/csv"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url;
            a.download = `aurum_history_${new Date().toISOString().slice(0,10)}.csv`;
            a.click(); URL.revokeObjectURL(url);
          }} style={{ marginLeft:"auto", background:"var(--goldDim)", border:"1px solid var(--gold)40", borderRadius:8, padding:"7px 14px", color:"var(--gold)", cursor:"pointer", fontSize:12, fontFamily:"'Syne',sans-serif", fontWeight:700 }}>⬇ Export CSV</button>
        </div>
      </Card>

      {/* Table */}
      <Card style={{ padding:0, overflow:"hidden" }}>
        <div className="table-wrap">
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:720 }}>
          <thead>
            <tr style={{ borderBottom:"1px solid var(--border)" }}>
              {["Type","Asset","Amount","Price","Total","Fee","Status","Date","TxID"].map((h,i) => (
                <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontSize:10, color:"var(--muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8, whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map(h => (
              <tr key={h.id} style={{ borderBottom:"1px solid var(--border)", transition:"background .15s" }}
                onMouseEnter={e=>e.currentTarget.style.background="var(--bg3)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{ padding:"12px 16px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:28, height:28, borderRadius:6, background:typeBg(h.type), display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:typeColor(h.type), fontWeight:700 }}>{typeIcon(h.type)}</div>
                    <span style={{ fontSize:12, fontWeight:600, color:typeColor(h.type) }}>{h.type}</span>
                  </div>
                </td>
                <td style={{ padding:"12px 16px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <CoinIcon sym={h.coin} color={h.coinColor} size={24} />
                    <span style={{ fontSize:12, fontWeight:600 }}>{h.coin}</span>
                  </div>
                </td>
                <td className="mono" style={{ padding:"12px 16px", fontSize:12 }}>{h.amount}</td>
                <td className="mono" style={{ padding:"12px 16px", fontSize:12, color:"var(--muted)" }}>{fmtPrice(h.price)}</td>
                <td className="mono" style={{ padding:"12px 16px", fontSize:12, fontWeight:600 }}>${h.total.toLocaleString()}</td>
                <td className="mono" style={{ padding:"12px 16px", fontSize:11, color:"var(--muted)" }}>${h.fee}</td>
                <td style={{ padding:"12px 16px" }}><Badge color={statusColor(h.status)}>{h.status}</Badge></td>
                <td className="mono" style={{ padding:"12px 16px", fontSize:11, color:"var(--muted)", whiteSpace:"nowrap" }}>
                  {h.date.toLocaleDateString("en",{month:"short",day:"numeric"})}{" "}
                  {h.date.toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit"})}
                </td>
                <td className="mono" style={{ padding:"12px 16px", fontSize:11, color:"var(--gold)", cursor:"pointer" }} title="View on explorer">{h.txid}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {/* Pagination */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px", borderTop:"1px solid var(--border)" }}>
          <span style={{ fontSize:12, color:"var(--muted)" }}>Showing {(page-1)*PER_PAGE+1}–{Math.min(page*PER_PAGE,filtered.length)} of {filtered.length}</span>
          <div style={{ display:"flex", gap:4 }}>
            <button onClick={()=>setPage2(p=>Math.max(1,p-1))} disabled={page===1} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:6, padding:"5px 10px", color:page===1?"var(--muted2)":"var(--text)", cursor:page===1?"default":"pointer", fontSize:12 }}>←</button>
            {Array.from({length:Math.min(5,pages)},(_,i)=>{
              const pg = page<=3 ? i+1 : page+i-2;
              if (pg<1||pg>pages) return null;
              return <button key={pg} onClick={()=>setPage2(pg)} style={{ background:pg===page?"var(--goldDim)":"var(--bg3)", border:pg===page?"1px solid var(--gold)":"1px solid var(--border)", borderRadius:6, padding:"5px 10px", color:pg===page?"var(--gold)":"var(--text)", cursor:"pointer", fontSize:12, fontFamily:"'DM Mono',monospace" }}>{pg}</button>;
            })}
            <button onClick={()=>setPage2(p=>Math.min(pages,p+1))} disabled={page===pages} style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:6, padding:"5px 10px", color:page===pages?"var(--muted2)":"var(--text)", cursor:page===pages?"default":"pointer", fontSize:12 }}>→</button>
          </div>
        </div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: CRYPTO NEWS (Claude AI-powered)
// ─────────────────────────────────────────────────────────────────────────────
const NEWS_TOPICS = ["Bitcoin","Ethereum","DeFi","Regulation","NFTs","Layer 2","Macro","Altcoins"];

const News = () => {
  const [topic,    setTopic]   = useState("Bitcoin");
  const [articles, setArts]   = useState([]);
  const [loading,  setLoading] = useState(false);
  const [loaded,   setLoaded]  = useState({});

  const fetchNews = async (t) => {
    if (loaded[t]) { setTopic(t); return; }
    setTopic(t); setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1000,
          system:"You generate realistic-looking crypto news article summaries. Return ONLY a JSON array, no markdown fences, no extra text.",
          messages:[{ role:"user", content:`Generate 6 realistic crypto news article summaries about "${t}" as of late 2025/early 2026. Each item must have: title (string), summary (2 sentences), source (realistic outlet name like CoinDesk/The Block/Decrypt/Bloomberg Crypto), time (e.g. "2h ago"), sentiment ("bullish"|"bearish"|"neutral"), readTime (e.g. "3 min read"). Return ONLY a JSON array.` }]
        })
      });
      const data = await res.json();
      const raw  = data.content?.map(b=>b.text||"").join("") || "[]";
      const clean = raw.replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      setLoaded(l => ({ ...l, [t]: parsed }));
      setArts(parsed);
    } catch(e) {
      setArts([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchNews("Bitcoin"); }, []);

  const sentimentColor = s => s==="bullish"?"var(--green)":s==="bearish"?"var(--red)":"var(--muted)";
  const sentimentIcon  = s => s==="bullish"?"↑":s==="bearish"?"↓":"→";

  const displayArts = loaded[topic] || articles;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Topic tabs */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        {NEWS_TOPICS.map(t => (
          <button key={t} onClick={()=>fetchNews(t)} style={{
            background: topic===t ? "var(--goldDim)" : "var(--bg2)",
            border: topic===t ? "1px solid var(--gold)" : "1px solid var(--border)",
            color: topic===t ? "var(--gold)" : "var(--muted)",
            borderRadius:20, padding:"7px 16px", cursor:"pointer",
            fontFamily:"'Syne',sans-serif", fontWeight:topic===t?700:500, fontSize:12, transition:"all .2s"
          }}>{t}</button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--muted)" }}>
          <div className="live-dot" /> AI-generated summaries
        </div>
      </div>

      {loading ? (
        <div className="rg-3" style={{ gap:14 }}>
          {Array.from({length:6}).map((_,i) => (
            <Card key={i} style={{ height:180, background:"linear-gradient(90deg,var(--bg2),var(--bg3),var(--bg2))", backgroundSize:"200% 100%", animation:"shimmer 1.5s infinite" }} />
          ))}
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
          {displayArts.map((a,i) => (
            <Card key={i} className="fade-up" style={{ cursor:"pointer", transition:"transform .2s, border-color .2s", position:"relative", overflow:"hidden" }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.borderColor="rgba(240,165,0,0.3)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.borderColor="var(--border)";}}>
              <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background: a.sentiment==="bullish"?"linear-gradient(90deg,var(--green),transparent)":a.sentiment==="bearish"?"linear-gradient(90deg,var(--red),transparent)":"linear-gradient(90deg,var(--muted2),transparent)" }} />
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <span style={{ fontSize:10, color:"var(--muted)", fontFamily:"'DM Mono',monospace" }}>{a.source}</span>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{ fontSize:10, color:sentimentColor(a.sentiment), fontWeight:700 }}>{sentimentIcon(a.sentiment)} {a.sentiment}</span>
                </div>
              </div>
              <div style={{ fontWeight:700, fontSize:13.5, lineHeight:1.45, marginBottom:10, color:"var(--text)" }}>{a.title}</div>
              <div style={{ fontSize:12, color:"var(--muted)", lineHeight:1.6, marginBottom:12 }}>{a.summary}</div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"var(--muted2)" }}>
                <span>{a.time}</span>
                <span>{a.readTime}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && displayArts.length === 0 && (
        <Card style={{ textAlign:"center", padding:40 }}>
          <div style={{ fontSize:24, marginBottom:8 }}>📰</div>
          <div style={{ color:"var(--muted)" }}>Click a topic above to load AI-generated news</div>
        </Card>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: EARN (Staking & Yield)
// ─────────────────────────────────────────────────────────────────────────────
const EARN_PRODUCTS = [
  { coin:"ETH",  name:"Ethereum",    color:"#627eea", apy:4.2,  minAmt:0.1,   lockDays:0,   type:"Flexible",  risk:"Low",    tvl:"$4.2B"  },
  { coin:"BTC",  name:"Bitcoin",     color:"#f7931a", apy:2.8,  minAmt:0.001, lockDays:0,   type:"Flexible",  risk:"Low",    tvl:"$8.1B"  },
  { coin:"SOL",  name:"Solana",      color:"#9945ff", apy:7.4,  minAmt:1,     lockDays:0,   type:"Flexible",  risk:"Medium", tvl:"$1.8B"  },
  { coin:"AVAX", name:"Avalanche",   color:"#e84142", apy:9.1,  minAmt:1,     lockDays:30,  type:"Locked",    risk:"Medium", tvl:"$890M"  },
  { coin:"LINK", name:"Chainlink",   color:"#2a5ada", apy:5.5,  minAmt:10,    lockDays:14,  type:"Locked",    risk:"Medium", tvl:"$420M"  },
  { coin:"DOT",  name:"Polkadot",    color:"#e6007a", apy:12.8, minAmt:5,     lockDays:90,  type:"Locked",    risk:"High",   tvl:"$310M"  },
  { coin:"MATIC",name:"Polygon",     color:"#8247e5", apy:8.3,  minAmt:50,    lockDays:30,  type:"Locked",    risk:"Medium", tvl:"$580M"  },
  { coin:"ADA",  name:"Cardano",     color:"#0033ad", apy:3.6,  minAmt:100,   lockDays:0,   type:"Flexible",  risk:"Low",    tvl:"$1.2B"  },
];

const MY_STAKES = [
  { coin:"ETH", color:"#627eea", staked:2.0,  apy:4.2,  earned:0.0214, days:18 },
  { coin:"SOL", color:"#9945ff", staked:20,   apy:7.4,  earned:0.148,  days:12 },
];

const Earn = ({ coins = COINS }) => {
  const [tab,      setTab]      = useState("Discover");
  const [riskF,    setRiskF]    = useState("All");
  const [typeF,    setTypeF]    = useState("All");
  const [stakeModal, setStakeModal] = useState(null);
  const [stakeAmt,   setStakeAmt]   = useState("");

  const filtered = EARN_PRODUCTS.filter(p =>
    (riskF==="All" || p.risk===riskF) &&
    (typeF==="All" || p.type===typeF)
  );

  const totalStakedUSD = MY_STAKES.reduce((a,s) => {
    const c = coins.find(x=>x.sym===s.coin);
    return a + (c ? c.price * s.staked : 0);
  },0);
  const totalEarnedUSD = MY_STAKES.reduce((a,s) => {
    const c = coins.find(x=>x.sym===s.coin);
    return a + (c ? c.price * s.earned : 0);
  },0);

  const riskColor = r => r==="Low"?"var(--green)":r==="Medium"?"var(--gold)":"var(--red)";

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Tabs */}
      <div style={{ display:"flex", gap:0, borderBottom:"1px solid var(--border)" }}>
        {["Discover","My Stakes"].map(t=><Tab key={t} label={t} active={tab===t} onClick={()=>setTab(t)} />)}
      </div>

      {tab==="My Stakes" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Summary */}
          <div className="rg-3" style={{ gap:12 }}>
            {[
              { label:"Total Staked",   val:`$${totalStakedUSD.toLocaleString(undefined,{maximumFractionDigits:0})}`, color:"var(--text)" },
              { label:"Total Earned",   val:`$${totalEarnedUSD.toFixed(2)}`,                                          color:"var(--green)" },
              { label:"Avg APY",        val:`${(MY_STAKES.reduce((a,s)=>a+s.apy,0)/MY_STAKES.length).toFixed(1)}%`,   color:"var(--gold)" },
            ].map(s=>(
              <Card key={s.label}>
                <div style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>{s.label}</div>
                <div className="mono" style={{ fontSize:22, color:s.color, fontWeight:500 }}>{s.val}</div>
              </Card>
            ))}
          </div>
          {MY_STAKES.map(s => {
            const coin  = coins.find(c=>c.sym===s.coin);
            const usdVal = coin ? coin.price * s.staked : 0;
            const earnUSD = coin ? coin.price * s.earned : 0;
            const dailyEarn = (s.staked * s.apy/100/365);
            return (
              <Card key={s.coin} style={{ position:"relative", overflow:"hidden" }}>
                <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,${s.color},transparent)` }} />
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <CoinIcon sym={s.coin} color={s.color} size={42} />
                    <div>
                      <div style={{ fontWeight:800, fontSize:16 }}>{s.coin}</div>
                      <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>Staked {s.days} days ago</div>
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:11, color:"var(--muted)", marginBottom:2 }}>APY</div>
                    <div className="mono" style={{ fontSize:22, color:"var(--green)", fontWeight:500 }}>{s.apy}%</div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12, marginTop:18 }}>
                  {[
                    { label:"Staked Amount",   val:`${s.staked} ${s.coin}`,       sub:`$${usdVal.toLocaleString(undefined,{maximumFractionDigits:0})}` },
                    { label:"Total Earned",    val:`${s.earned.toFixed(4)} ${s.coin}`, sub:`$${earnUSD.toFixed(4)}`, color:"var(--green)" },
                    { label:"Daily Earnings",  val:`${dailyEarn.toFixed(6)} ${s.coin}`, sub:"est." },
                    { label:"Status",          val:"Active", color:"var(--green)" },
                  ].map(f=>(
                    <div key={f.label} style={{ background:"var(--bg3)", borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.6, marginBottom:4 }}>{f.label}</div>
                      <div className="mono" style={{ fontSize:13, color:f.color||"var(--text)", fontWeight:600 }}>{f.val}</div>
                      {f.sub && <div style={{ fontSize:10, color:"var(--muted)", marginTop:2 }}>{f.sub}</div>}
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:8, marginTop:14 }}>
                  <GoldBtn style={{ padding:"8px 20px", fontSize:12 }}>Claim Rewards</GoldBtn>
                  <GoldBtn outline style={{ padding:"8px 20px", fontSize:12 }}>Unstake</GoldBtn>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <>
          {/* Filters */}
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <div style={{ display:"flex", gap:4 }}>
              {["All","Low","Medium","High"].map(r=>(
                <button key={r} onClick={()=>setRiskF(r)} style={{ background:riskF===r?"var(--goldDim)":"var(--bg3)", border:riskF===r?"1px solid var(--gold)":"1px solid var(--border)", color:riskF===r?"var(--gold)":"var(--muted)", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:11, fontFamily:"'Syne',sans-serif" }}>{r==="All"?"All Risk":r}</button>
              ))}
            </div>
            <div style={{ display:"flex", gap:4 }}>
              {["All","Flexible","Locked"].map(t=>(
                <button key={t} onClick={()=>setTypeF(t)} style={{ background:typeF===t?"var(--goldDim)":"var(--bg3)", border:typeF===t?"1px solid var(--gold)":"1px solid var(--border)", color:typeF===t?"var(--gold)":"var(--muted)", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:11, fontFamily:"'Syne',sans-serif" }}>{t==="All"?"All Types":t}</button>
              ))}
            </div>
          </div>

          {/* Products grid */}
          <div className="rg-2 earn-grid" style={{ gap:14 }}>
            {filtered.map(p => (
              <Card key={p.coin} style={{ cursor:"pointer", position:"relative", overflow:"hidden", transition:"transform .2s, border-color .2s" }}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.borderColor=`${p.color}40`;}}
                onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.borderColor="var(--border)";}}>
                <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,${p.color},transparent)` }} />
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <CoinIcon sym={p.coin} color={p.color} size={38} />
                    <div>
                      <div style={{ fontWeight:800, fontSize:15 }}>{p.coin}</div>
                      <div style={{ fontSize:11, color:"var(--muted)", marginTop:1 }}>{p.name}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:11, color:"var(--muted)" }}>APY</div>
                    <div className="mono" style={{ fontSize:26, color:"var(--green)", fontWeight:500, lineHeight:1.1 }}>{p.apy}%</div>
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:14 }}>
                  {[
                    { label:"Type",     val:p.type },
                    { label:"Lock",     val:p.lockDays===0?"None":`${p.lockDays}d` },
                    { label:"Risk",     val:p.risk, color:riskColor(p.risk) },
                    { label:"TVL",      val:p.tvl },
                  ].map(f=>(
                    <div key={f.label} style={{ background:"var(--bg3)", borderRadius:6, padding:"7px 9px" }}>
                      <div style={{ fontSize:9, color:"var(--muted)", textTransform:"uppercase", letterSpacing:0.6 }}>{f.label}</div>
                      <div className="mono" style={{ fontSize:11, color:f.color||"var(--text)", fontWeight:600, marginTop:3 }}>{f.val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:11, color:"var(--muted)" }}>Min: {p.minAmt} {p.coin}</div>
                    <div className="mono" style={{ fontSize:10, color:"var(--green)", marginTop:2 }}>
                      ${((p.apy/100) * (coins.find(c=>c.sym===p.coin)?.price||1) * p.minAmt / 12).toFixed(2)}/mo per {p.minAmt} {p.coin}
                    </div>
                  </div>
                  <GoldBtn style={{ padding:"7px 18px", fontSize:12 }} onClick={()=>setStakeModal(p)}>Stake Now</GoldBtn>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Stake modal */}
      {stakeModal && (
        <div onClick={()=>setStakeModal(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", backdropFilter:"blur(8px)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:16, padding:28, width:420, maxWidth:"90vw" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <CoinIcon sym={stakeModal.coin} color={stakeModal.color} size={36} />
                <div>
                  <div style={{ fontWeight:800, fontSize:16 }}>Stake {stakeModal.coin}</div>
                  <div style={{ fontSize:12, color:"var(--green)" }}>{stakeModal.apy}% APY</div>
                </div>
              </div>
              <button onClick={()=>setStakeModal(null)} style={{ background:"none", border:"none", color:"var(--muted)", cursor:"pointer", fontSize:20 }}>✕</button>
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>Amount to Stake</div>
              <div style={{ position:"relative" }}>
                <input value={stakeAmt} onChange={e=>setStakeAmt(e.target.value)} placeholder={`Min ${stakeModal.minAmt} ${stakeModal.coin}`}
                  style={{ width:"100%", background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"11px 60px 11px 14px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:13, outline:"none" }} />
                <span style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", fontSize:12 }}>{stakeModal.coin}</span>
              </div>
            </div>
            {stakeAmt && parseFloat(stakeAmt) > 0 && (
              <div style={{ background:"var(--bg3)", borderRadius:8, padding:"12px 14px", marginBottom:16, fontSize:12 }}>
                {[
                  ["Est. daily earnings", `${(parseFloat(stakeAmt)*stakeModal.apy/100/365).toFixed(6)} ${stakeModal.coin}`],
                  ["Est. monthly earnings", `${(parseFloat(stakeAmt)*stakeModal.apy/100/12).toFixed(4)} ${stakeModal.coin}`],
                  ["Est. yearly earnings",  `${(parseFloat(stakeAmt)*stakeModal.apy/100).toFixed(4)} ${stakeModal.coin}`],
                ].map(([l,v])=>(
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"1px solid var(--border)" }}>
                    <span style={{ color:"var(--muted)" }}>{l}</span>
                    <span className="mono" style={{ color:"var(--green)" }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
            {stakeModal.lockDays > 0 && (
              <div style={{ background:"rgba(240,165,0,0.08)", border:"1px solid rgba(240,165,0,0.2)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"var(--muted)", marginBottom:16 }}>
                ⚠ This product has a <strong style={{ color:"var(--gold)" }}>{stakeModal.lockDays}-day lock period</strong>. You cannot unstake during this time.
              </div>
            )}
            <GoldBtn style={{ width:"100%", padding:13 }} onClick={()=>setStakeModal(null)}>Confirm Stake</GoldBtn>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT: SIDEBAR + TOPBAR
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// HOOKS: usePrevious for price change flash
// ─────────────────────────────────────────────────────────────────────────────
const usePrevious = (value) => {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
};

const PriceFlash = ({ value, decimals=2, prefix="$", style:s={} }) => {
  const prev = usePrevious(value);
  const [flash, setFlash] = useState(null); // 'up' | 'down' | null
  useEffect(() => {
    if (prev === undefined || prev === value) return;
    setFlash(value > prev ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span className="mono" style={{
      color: flash==="up" ? "var(--green)" : flash==="down" ? "var(--red)" : "var(--text)",
      transition:"color .4s",
      fontWeight: flash ? 700 : "inherit",
      ...s
    }}>
      {prefix}{typeof value === "number" ? value.toLocaleString(undefined,{minimumFractionDigits:decimals,maximumFractionDigits:decimals}) : value}
    </span>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// TOAST NOTIFICATION SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const Toast = ({ toasts, remove }) => (
  <div style={{ position:"fixed", top:20, right:20, zIndex:500, display:"flex", flexDirection:"column", gap:8 }}>
    {toasts.map(t => (
      <div key={t.id} className="slide-in" style={{ background:"var(--bg2)", border:`1px solid ${t.type==="success"?"rgba(0,228,154,0.3)":t.type==="error"?"rgba(255,77,109,0.3)":"rgba(240,165,0,0.3)"}`, borderRadius:12, padding:"12px 16px", display:"flex", alignItems:"center", gap:12, minWidth:260, boxShadow:"0 8px 32px rgba(0,0,0,0.4)", cursor:"pointer" }} onClick={()=>remove(t.id)}>
        <span style={{ fontSize:18 }}>{t.type==="success"?"✅":t.type==="error"?"❌":"💡"}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:13 }}>{t.title}</div>
          {t.sub && <div style={{ fontSize:11, color:"var(--muted)", marginTop:1 }}>{t.sub}</div>}
        </div>
        <span style={{ color:"var(--muted)", fontSize:16 }}>✕</span>
      </div>
    ))}
  </div>
);

const useToast = () => {
  const [toasts, setToasts] = useState([]);
  const add = (title, sub="", type="info") => {
    const id = Date.now();
    setToasts(t => [...t, { id, title, sub, type }]);
    setTimeout(() => setToasts(t => t.filter(x=>x.id!==id)), 4000);
  };
  const remove = (id) => setToasts(t => t.filter(x=>x.id!==id));
  return { toasts, add, remove };
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT: Share live coin prices across all pages
// ─────────────────────────────────────────────────────────────────────────────
const CoinsContext = createContext(COINS);
const useCoins = () => useContext(CoinsContext);

const NAV_TOP = [
  { id:"dashboard", label:"Dashboard", icon:"⬡" },
  { id:"markets",   label:"Markets",   icon:"◈" },
  { id:"portfolio", label:"Portfolio", icon:"◎" },
  { id:"trade",     label:"Trade",     icon:"⇄" },
];
const NAV_BOT = [
  { id:"wallet",    label:"Wallet",    icon:"◇" },
  { id:"earn",      label:"Earn",      icon:"◆" },
  { id:"history",   label:"History",   icon:"≡" },
  { id:"analytics", label:"Analytics", icon:"◉" },
  { id:"news",      label:"News",      icon:"◫" },
  { id:"alerts",    label:"Alerts",    icon:"◎" },
  { id:"settings",  label:"Settings",  icon:"⚙" },
];
const NAV = [...NAV_TOP, ...NAV_BOT];
const MOBILE_NAV = [
  { id:"dashboard", label:"Home",      icon:"⬡" },
  { id:"markets",   label:"Markets",   icon:"◈" },
  { id:"trade",     label:"Trade",     icon:"⇄" },
  { id:"portfolio", label:"Portfolio", icon:"◎" },
  { id:"wallet",    label:"Wallet",    icon:"◇" },
];

// ─────────────────────────────────────────────────────────────────────────────
// ENHANCED AI ASSISTANT (with live prices in context)
// ─────────────────────────────────────────────────────────────────────────────
const EnhancedAI = ({ onClose, coins }) => {
  const [msgs,    setMsgs]    = useState([{ role:"assistant", text:"Hello! I'm your Aurum AI advisor powered by Claude.\n\nI have real-time access to your portfolio and live market prices. Ask me anything — portfolio analysis, market insights, trading strategies, or risk assessment." }]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [liveCtx, setLiveCtx]= useState(false);
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const SUGGESTED = [
    "How is my portfolio performing?",
    "Which coin has the best momentum right now?",
    "Suggest how to rebalance my portfolio",
    "What's the risk profile of my holdings?",
    "Explain today's market conditions",
    "Which positions should I consider cutting?",
  ];

  const buildContext = () => {
    const liveStr = coins.map(c => `${c.sym}: $${c.price.toLocaleString()} (24h: ${c.chg24h >= 0 ? "+" : ""}${c.chg24h.toFixed(2)}%, 7d: ${c.chg7d >= 0 ? "+" : ""}${c.chg7d.toFixed(2)}%)`).join(", ");
    const holdStr  = HOLDINGS.map(h => {
      const cur = coins.find(c=>c.id===h.id)?.price || h.avgBuy;
      const pnlPct = ((cur-h.avgBuy)/h.avgBuy*100).toFixed(1);
      return `${h.sym} ${h.amount} units @ avg $${h.avgBuy.toLocaleString()} → now $${cur.toLocaleString()} (${pnlPct >= 0 ? "+" : ""}${pnlPct}%)`;
    }).join("; ");
    const totalVal = HOLDINGS.reduce((a,h) => a + (coins.find(c=>c.id===h.id)?.price||h.avgBuy)*h.amount, 0);
    const totalCost = HOLDINGS.reduce((a,h) => a + h.avgBuy*h.amount, 0);
    const totalPnl = ((totalVal-totalCost)/totalCost*100).toFixed(1);
    return `LIVE market data (just fetched): ${liveStr}.\n\nUser portfolio: ${holdStr}.\n\nTotal portfolio value: $${totalVal.toLocaleString(undefined,{maximumFractionDigits:0})} | Total cost basis: $${totalCost.toLocaleString(undefined,{maximumFractionDigits:0})} | Overall P&L: ${totalPnl >= 0 ? "+" : ""}${totalPnl}%.`;
  };

  const send = async (text) => {
    const q = (text || input).trim();
    if (!q || loading) return;
    setInput("");
    const userMsg = { role:"user", text:q };
    setMsgs(m => [...m, userMsg]);
    setLoading(true);
    try {
      const contextStr = buildContext();
      const history = msgs.filter((_,i)=>i>0).map(m => ({ role:m.role, content:m.text }));
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1000,
          system:`You are Aurum, a professional crypto investment advisor with real-time market data. Be concise, insightful, data-driven. Reference specific numbers from the context. Never give financial advice — frame everything as analysis and education. Use bullet points for lists. Keep responses under 200 words.\n\n${contextStr}`,
          messages:[...history, { role:"user", content:q }]
        })
      });
      const data = await res.json();
      const reply = data.content?.map(b=>b.text||"").join("") || "Sorry, couldn't reach the AI. Try again.";
      setMsgs(m => [...m, { role:"assistant", text:reply }]);
      setLiveCtx(true);
    } catch(e) {
      setMsgs(m => [...m, { role:"assistant", text:"Connection error. Please try again." }]);
    }
    setLoading(false);
  };

  return (
    <div className="ai-panel slide-in" style={{ position:"fixed", right:0, top:0, bottom:0, width:380, background:"var(--bg2)", borderLeft:"1px solid var(--border)", display:"flex", flexDirection:"column", zIndex:200, boxShadow:"-20px 0 60px rgba(0,0,0,0.5)" }}>
      <div style={{ padding:"16px 18px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:38, height:38, borderRadius:10, background:"linear-gradient(135deg,#f0a500,#ffc333)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>✦</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:800, fontSize:14 }}>Aurum AI Advisor</div>
          <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:10, marginTop:1 }}>
            <span style={{ color:"var(--green)", display:"flex", alignItems:"center", gap:4 }}><div className="live-dot" /> Claude-powered</span>
            {liveCtx && <span style={{ color:"var(--gold)" }}>· Live prices active</span>}
          </div>
        </div>
        <button onClick={onClose} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--muted)", width:30, height:30, borderRadius:8, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"14px 14px 6px" }}>
        {msgs.map((m,i) => (
          <div key={i} style={{ display:"flex", gap:8, marginBottom:14, flexDirection:m.role==="user"?"row-reverse":"row" }}>
            <div style={{ width:28, height:28, borderRadius:8, flexShrink:0, background:m.role==="user"?"linear-gradient(135deg,#f0a500,#ffc333)":"var(--bg4)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, color:m.role==="user"?"#000":"var(--gold)", fontWeight:800 }}>
              {m.role==="user"?"A":"✦"}
            </div>
            <div style={{ maxWidth:"82%", background:m.role==="user"?"var(--goldDim)":"var(--bg3)", border:`1px solid ${m.role==="user"?"rgba(240,165,0,0.25)":"var(--border)"}`, borderRadius:m.role==="user"?"12px 3px 12px 12px":"3px 12px 12px 12px", padding:"10px 13px", fontSize:12.5, lineHeight:1.65, color:"var(--text)", whiteSpace:"pre-wrap" }}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display:"flex", gap:8, marginBottom:14 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:"var(--bg4)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--gold)", fontSize:12 }}>✦</div>
            <div style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:"3px 12px 12px 12px", padding:"14px 18px", display:"flex", gap:5, alignItems:"center" }}>
              {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"var(--gold)", animation:`pulse 1.2s ${i*0.2}s infinite` }}/>)}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {msgs.length < 3 && (
        <div style={{ padding:"0 14px 10px" }}>
          <div style={{ fontSize:10, color:"var(--muted)", marginBottom:8, textTransform:"uppercase", letterSpacing:0.8 }}>Quick questions</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {SUGGESTED.map(s=>(
              <button key={s} onClick={()=>send(s)} style={{ background:"var(--bg3)", border:"1px solid var(--border)", color:"var(--muted)", borderRadius:16, padding:"5px 11px", cursor:"pointer", fontSize:11, fontFamily:"'Syne',sans-serif", transition:"all .2s" }}
                onMouseEnter={e=>{e.currentTarget.style.color="var(--gold)";e.currentTarget.style.borderColor="rgba(240,165,0,0.4)";}}
                onMouseLeave={e=>{e.currentTarget.style.color="var(--muted)";e.currentTarget.style.borderColor="var(--border)";}}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding:"10px 12px 14px", borderTop:"1px solid var(--border)" }}>
        <div style={{ display:"flex", gap:8, background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:12, padding:"8px 8px 8px 13px", alignItems:"flex-end" }}>
          <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Ask about your portfolio…" rows={1}
            style={{ flex:1, background:"none", border:"none", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:13, resize:"none", outline:"none", lineHeight:1.5, maxHeight:90, overflowY:"auto" }}/>
          <button onClick={()=>send()} disabled={loading||!input.trim()} style={{ width:34, height:34, borderRadius:8, background:input.trim()?"linear-gradient(135deg,#f0a500,#ffc333)":"var(--bg4)", border:"none", cursor:input.trim()?"pointer":"default", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>→</button>
        </div>
        <div style={{ fontSize:10, color:"var(--muted2)", textAlign:"center", marginTop:7 }}>Powered by Claude · Uses live market data · Not financial advice</div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION DROPDOWN
// ─────────────────────────────────────────────────────────────────────────────
const NOTIFS = [
  { icon:"📈", title:"BTC up 2.18% in 24h", sub:"Bitcoin breaking resistance", time:"2m ago",  unread:true  },
  { icon:"🔔", title:"Alert triggered: ETH below $3,800", sub:"Your alert fired", time:"1h ago", unread:true  },
  { icon:"✅", title:"Trade executed", sub:"Bought 0.12 BTC at $67,200", time:"2h ago", unread:true  },
  { icon:"💰", title:"Staking reward claimed", sub:"0.0214 ETH earned", time:"1d ago",  unread:false },
  { icon:"🔐", title:"New login detected", sub:"Chrome on macOS · San Francisco", time:"2d ago", unread:false },
];

const NotifDropdown = ({ onClose, onNavigate }) => (
  <div className="scale-in" style={{ position:"absolute", top:"calc(100% + 8px)", right:0, width:320, background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14, boxShadow:"0 20px 60px rgba(0,0,0,0.5)", zIndex:300, overflow:"hidden" }}>
    <div style={{ padding:"14px 16px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <span style={{ fontWeight:700, fontSize:14 }}>Notifications</span>
      <span style={{ fontSize:11, color:"var(--gold)", cursor:"pointer" }}>Mark all read</span>
    </div>
    {NOTIFS.map((n,i) => (
      <div key={i} onClick={onClose} style={{ display:"flex", gap:12, padding:"12px 16px", borderBottom:"1px solid var(--border)", cursor:"pointer", background:n.unread?"rgba(240,165,0,0.03)":"transparent", transition:"background .15s" }}
        onMouseEnter={e=>e.currentTarget.style.background="var(--bg3)"}
        onMouseLeave={e=>e.currentTarget.style.background=n.unread?"rgba(240,165,0,0.03)":"transparent"}>
        <div style={{ fontSize:20, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", background:"var(--bg3)", borderRadius:8, flexShrink:0 }}>{n.icon}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:12, fontWeight:n.unread?700:500, marginBottom:2 }}>{n.title}</div>
          <div style={{ fontSize:11, color:"var(--muted)" }}>{n.sub}</div>
          <div style={{ fontSize:10, color:"var(--muted2)", marginTop:3 }}>{n.time}</div>
        </div>
        {n.unread && <div style={{ width:7, height:7, borderRadius:"50%", background:"var(--gold)", flexShrink:0, marginTop:4 }}/>}
      </div>
    ))}
    <div style={{ padding:"10px 16px", textAlign:"center", fontSize:12, color:"var(--gold)", cursor:"pointer" }}>View all notifications</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const { user, displayName: userName, signOut } = useAuth();
  const [page,      setPage]      = useState("dashboard");
  const [aiOpen,    setAiOpen]    = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { toasts, add: addToast, remove: removeToast } = useToast();

  // Show welcome toast on first load
  useEffect(() => {
    if (user) setTimeout(() => addToast(`Welcome back, ${userName}!`, "Your portfolio is live.", "success"), 600);
  }, []);
  const { live, lastUpdate, error, wsConnected } = useLivePrices();
  const coins = mergeCoins(COINS, live);
  const btcPrice = coins.find(c=>c.id==="btc")?.price || 68420;
  const notifRef = useRef(null);

  // Close notif on outside click
  useEffect(() => {
    const fn = e => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const titles = {
    dashboard:"Dashboard", markets:"Live Markets", portfolio:"My Portfolio",
    trade:"Trade", wallet:"Wallet", analytics:"Analytics",
    alerts:"Price Alerts", settings:"Settings",
    history:"Transaction History", news:"Crypto News", earn:"Earn & Stake",
  };

  const mkPages = (c) => ({
    dashboard: <Dashboard coins={c}/>,
    markets:   <Markets   coins={c}/>,
    portfolio: <Portfolio coins={c}/>,
    trade:     <Trade     coins={c} addTradeToast={addToast}/>,
    wallet:    <Wallet    coins={c}/>,
    analytics: <Analytics coins={c}/>,
    alerts:    <Alerts    coins={c}/>,
    settings:  <Settings />,
    history:   <History />,
    news:      <News />,
    earn:      <Earn      coins={c}/>,
  });

  const nav = (id) => { setPage(id); setNotifOpen(false); };
  const unreadCount = NOTIFS.filter(n=>n.unread).length;

  return (
    <CoinsContext.Provider value={coins}>
      <div style={{ display:"flex", minHeight:"100vh", fontFamily:"'Syne',sans-serif", flexDirection:"column" }}>

        {/* Price ticker */}
        <TickerBar coins={coins} />

        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
          {/* ── Sidebar ── */}
          <div className="sidebar" style={{ width:220, background:"var(--bg2)", borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column", flexShrink:0, position:"sticky", top:0, height:"calc(100vh - 33px)", zIndex:50, overflow:"hidden" }}>
            <div style={{ padding:"18px 18px 14px", borderBottom:"1px solid var(--border)", flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:32, height:32, background:"linear-gradient(135deg,#f0a500,#ffc333)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:800, color:"#000", boxShadow:"0 4px 12px rgba(240,165,0,0.3)" }}>◈</div>
                <div>
                  <div style={{ fontWeight:800, fontSize:15, letterSpacing:0.5 }}>AURUM</div>
                  <div style={{ fontSize:9, color:"var(--muted)", letterSpacing:2 }}>CRYPTO PLATFORM</div>
                </div>
              </div>
            </div>

            {/* Live price indicator */}
            <div style={{ padding:"8px 14px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
              {error ? (
                <span style={{ fontSize:10, color:"var(--gold)" }}>⚠ REST fallback</span>
              ) : wsConnected ? (
                <><div className="live-dot"/><span style={{ fontSize:10, color:"var(--muted)" }}>WS Live · {lastUpdate?.toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span></>
              ) : live ? (
                <><div style={{ width:6,height:6,borderRadius:"50%",background:"var(--gold)",animation:"pulse 1.5s infinite" }}/><span style={{ fontSize:10, color:"var(--muted)" }}>REST · {lastUpdate?.toLocaleTimeString("en",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span></>
              ) : (
                <><div style={{ width:6,height:6,borderRadius:"50%",background:"var(--gold)",animation:"pulse 1s infinite" }}/><span style={{ fontSize:10, color:"var(--muted)" }}>Connecting…</span></>
              )}
            </div>

            <nav style={{ flex:1, padding:"8px 8px", overflowY:"auto" }}>
              <div style={{ fontSize:9, color:"var(--muted2)", textTransform:"uppercase", letterSpacing:1.2, padding:"6px 6px 4px", marginBottom:2 }}>Main</div>
              {NAV_TOP.map(n => (
                <button key={n.id} onClick={()=>nav(n.id)} style={{ display:"flex", alignItems:"center", gap:9, width:"100%", background:page===n.id?"linear-gradient(90deg,var(--goldDim),transparent)":"none", border:"none", borderLeft:page===n.id?"2px solid var(--gold)":"2px solid transparent", color:page===n.id?"var(--gold)":"var(--muted)", borderRadius:"0 8px 8px 0", padding:"9px 12px", cursor:"pointer", fontFamily:"'Syne',sans-serif", fontWeight:page===n.id?700:500, fontSize:12.5, textAlign:"left", transition:"all .2s", marginBottom:1 }}>
                  <span style={{ fontSize:14, width:18 }}>{n.icon}</span>{n.label}
                </button>
              ))}

              <div style={{ fontSize:9, color:"var(--muted2)", textTransform:"uppercase", letterSpacing:1.2, padding:"10px 6px 4px", marginBottom:2 }}>Finance</div>
              {NAV_BOT.map(n => (
                <button key={n.id} onClick={()=>nav(n.id)} style={{ display:"flex", alignItems:"center", gap:9, width:"100%", background:page===n.id?"linear-gradient(90deg,var(--goldDim),transparent)":"none", border:"none", borderLeft:page===n.id?"2px solid var(--gold)":"2px solid transparent", color:page===n.id?"var(--gold)":"var(--muted)", borderRadius:"0 8px 8px 0", padding:"9px 12px", cursor:"pointer", fontFamily:"'Syne',sans-serif", fontWeight:page===n.id?700:500, fontSize:12.5, textAlign:"left", transition:"all .2s", marginBottom:1 }}>
                  <span style={{ fontSize:14, width:18 }}>{n.icon}</span>{n.label}
                  {n.id==="alerts" && <span style={{ marginLeft:"auto", width:16, height:16, background:"var(--red)", borderRadius:"50%", fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:700 }}>3</span>}
                </button>
              ))}

              <div style={{ margin:"8px 0 0", padding:"8px 0 0", borderTop:"1px solid var(--border)" }}>
                <button onClick={()=>setAiOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:9, width:"100%", background:aiOpen?"linear-gradient(90deg,rgba(240,165,0,0.18),transparent)":"linear-gradient(90deg,rgba(240,165,0,0.05),transparent)", border:"none", borderLeft:aiOpen?"2px solid var(--gold)":"2px solid rgba(240,165,0,0.3)", color:aiOpen?"var(--gold)":"rgba(240,165,0,0.65)", borderRadius:"0 8px 8px 0", padding:"9px 12px", cursor:"pointer", fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:12.5, textAlign:"left", transition:"all .2s" }}>
                  <span style={{ fontSize:14, width:18 }}>✦</span>AI Advisor
                  <span style={{ marginLeft:"auto", fontSize:8, background:"var(--gold)", color:"#000", borderRadius:3, padding:"1px 5px", fontWeight:800 }}>LIVE</span>
                </button>
              </div>
            </nav>

            <div style={{ padding:"12px 14px", borderTop:"1px solid var(--border)", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
              <div style={{ width:32, height:32, borderRadius:"50%", background:"linear-gradient(135deg,var(--gold),#f7931a)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, color:"#000", flexShrink:0, fontSize:13 }}>A</div>
              <div style={{ flex:1, overflow:"hidden" }}>
                <div style={{ fontSize:12, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{userName}</div>
                <div style={{ fontSize:10, color:"var(--muted)" }}>Pro Account</div>
              </div>
              <button onClick={signOut} style={{ background:"none", border:"none", color:"var(--muted2)", cursor:"pointer", fontSize:12, padding:2 }} title="Sign out">⎋</button>
            </div>
          </div>

          {/* ── Main ── */}
          <div className="main-wrap" style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", transition:"margin-right .3s ease", marginRight:aiOpen?380:0 }}>
            {/* Topbar */}
            <div className="topbar" style={{ padding:"12px 24px", borderBottom:"1px solid var(--border)", background:"var(--bg2)", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:40, flexShrink:0 }}>
              <div>
                <div style={{ fontWeight:800, fontSize:17 }}>{titles[page]}</div>
                <div className="mono hide-mobile" style={{ fontSize:10, color:"var(--muted)", marginTop:1 }}>
                  {new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
                </div>
              </div>
              <div className="hide-mobile" style={{ position:"relative", marginLeft:12 }}>
                <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", fontSize:12 }}>🔍</span>
                <input placeholder="Search coins, pages…" onClick={()=>nav("markets")}
                  style={{ background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"7px 12px 7px 32px", color:"var(--text)", fontFamily:"'Syne',sans-serif", fontSize:12, outline:"none", width:200, cursor:"pointer" }}
                  onFocus={e=>{e.target.style.borderColor="rgba(240,165,0,0.4)"; e.target.style.width="260px"; e.target.style.transition="width .2s";}}
                  onBlur={e=>{e.target.style.borderColor="var(--border)"; e.target.style.width="200px";}}
                />
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div className="mono hide-mobile" style={{ fontSize:11, color:"var(--muted)", display:"flex", alignItems:"center", gap:10, background:"var(--bg3)", border:"1px solid var(--border)", borderRadius:8, padding:"6px 12px" }}>
                  <span style={{display:"flex",alignItems:"center",gap:5}}>
                    <div className="live-dot"/>
                    BTC ${btcPrice >= 1000 ? btcPrice.toLocaleString(undefined,{maximumFractionDigits:0}) : btcPrice.toFixed(2)}
                    {wsConnected ? <span style={{ color:"var(--green)", fontSize:9, marginLeft:2 }}>WS●</span> : live ? <span style={{ color:"var(--gold)", fontSize:9, marginLeft:2 }}>REST</span> : null}
                  </span>
                  <span style={{width:1,height:14,background:"var(--border)",display:"inline-block"}}/>
                  <span style={{color:coins.find(c=>c.id==="eth")?.chg24h>=0?"var(--green)":"var(--red)"}}>
                    ETH ${(coins.find(c=>c.id==="eth")?.price||3812).toLocaleString(undefined,{maximumFractionDigits:0})}
                  </span>
                </div>
                <div style={{ position:"relative" }} ref={notifRef}>
                  <button onClick={()=>setNotifOpen(o=>!o)} style={{ background:notifOpen?"var(--goldDim)":"var(--bg3)", border:notifOpen?"1px solid var(--gold)":"1px solid var(--border)", borderRadius:8, padding:"7px 11px", color:notifOpen?"var(--gold)":"var(--muted)", cursor:"pointer", fontSize:15, position:"relative" }}>
                    🔔
                    {unreadCount > 0 && <span style={{ position:"absolute", top:-4, right:-4, width:15, height:15, background:"var(--red)", borderRadius:"50%", fontSize:8, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:700 }}>{unreadCount}</span>}
                  </button>
                  {notifOpen && <NotifDropdown onClose={()=>setNotifOpen(false)} onNavigate={nav}/>}
                </div>
                <button onClick={()=>setAiOpen(o=>!o)} style={{ background:aiOpen?"var(--goldDim)":"var(--bg3)", border:aiOpen?"1px solid var(--gold)":"1px solid var(--border)", borderRadius:8, padding:"7px 13px", color:aiOpen?"var(--gold)":"var(--muted)", cursor:"pointer", fontSize:12, fontFamily:"'Syne',sans-serif", fontWeight:700, transition:"all .2s" }}>✦ AI</button>
                <GoldBtn onClick={()=>nav("trade")} style={{ padding:"7px 16px", fontSize:12 }}>+ Trade</GoldBtn>
              </div>
            </div>

            {/* Page */}
            <div className="page-body" style={{ flex:1, padding:"20px 24px", overflowY:"auto" }}>
              <PageTransition pageKey={page}>
                {mkPages(coins)[page]}
              </PageTransition>
            </div>
          </div>

          {/* AI Panel */}
          {aiOpen && <EnhancedAI onClose={()=>setAiOpen(false)} coins={coins}/>}

          {/* Toast Notifications */}
          <Toast toasts={toasts} remove={removeToast}/>
        </div>

        {/* ── Mobile bottom nav ── */}
        <nav className="bottom-nav">
          {MOBILE_NAV.map(n => (
            <button key={n.id} onClick={()=>nav(n.id)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2, background:"none", border:"none", color:page===n.id?"var(--gold)":"var(--muted)", cursor:"pointer", padding:"4px 6px", fontFamily:"'Syne',sans-serif", flex:1 }}>
              <span style={{ fontSize:18, lineHeight:1 }}>{n.icon}</span>
              <span style={{ fontSize:9, fontWeight:page===n.id?700:400 }}>{n.label}</span>
            </button>
          ))}
          <button onClick={()=>setAiOpen(o=>!o)} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"none", border:"none", color:aiOpen?"var(--gold)":"rgba(240,165,0,0.6)", cursor:"pointer", padding:"4px 8px", fontFamily:"'Syne',sans-serif", minWidth:52 }}>
            <span style={{ fontSize:18, lineHeight:1 }}>✦</span>
            <span style={{ fontSize:9, fontWeight:700 }}>AI</span>
          </button>
        </nav>
      </div>
    </CoinsContext.Provider>
  );
}
