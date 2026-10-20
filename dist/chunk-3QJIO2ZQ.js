import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
function r(e){if(!e||e<1)return!1;try{return process.kill(e,0),!0}catch(t){return t?.code==="EPERM"}}function o(e){let t=e.readJson(e.p.listen),i=e.readJson(e.p.live),n=r(i?.pid);return t?.mode==="idle"&&r(t.pid)?"ready":t?.mode==="busy"&&(r(t.pid)||n)?"working":n?"idle":"away"}export{r as a,o as b};
