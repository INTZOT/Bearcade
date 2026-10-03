// Offline pose landmarks in the same model coordinates as Blockbench previews.
export function createBoneSampler(geometry) {
  const bones = new Map(geometry.bones.map(b => [b.name, b]));
  function sample(track, t, fallback) {
    if (!track) return fallback;
    if (Array.isArray(track)) return track;
    const entries = Object.entries(track).map(([k,v]) => [Number(k),v]).sort((a,b) => a[0]-b[0]);
    let i=0; while(i<entries.length-1 && entries[i+1][0]<=t) i++;
    const [a,av]=entries[i], [b,bv]=entries[Math.min(i+1,entries.length-1)];
    const value=v=>Array.isArray(v)?v:(v.post??v.pre);
    const x=value(av), y=value(bv), u=b===a?0:Math.max(0,Math.min(1,(t-a)/(b-a)));
    return x.map((n,j)=>Number(n)+(Number(y[j])-Number(n))*u);
  }
  return (animation, name, t, offset=[0,-1.5,0]) => {
    let bone=bones.get(name), point=bone.pivot.map((v,i)=>v+offset[i]);
    while(bone) {
      const ch=animation.bones[bone.name]??{}, pos=sample(ch.position,t,[0,0,0]);
      const rot=sample(ch.rotation,t,[0,0,0]), scale=sample(ch.scale,t,[1,1,1]), pivot=bone.pivot??[0,0,0];
      let [x,y,z]=point.map((v,i)=>(v-pivot[i])*scale[i]);
      const angles=[-(rot[0]+(bone.rotation?.[0]??0)),-(rot[1]+(bone.rotation?.[1]??0)),rot[2]+(bone.rotation?.[2]??0)].map(v=>v*Math.PI/180);
      let c=Math.cos(angles[0]),s=Math.sin(angles[0]);[y,z]=[y*c-z*s,y*s+z*c];
      c=Math.cos(angles[1]);s=Math.sin(angles[1]);[x,z]=[x*c+z*s,-x*s+z*c];
      c=Math.cos(angles[2]);s=Math.sin(angles[2]);[x,y]=[x*c-y*s,x*s+y*c];
      point=[x,y,z].map((v,i)=>v+pivot[i]+pos[i]);bone=bones.get(bone.parent);
    }
    return point.map(v=>Math.round(v*10000)/10000);
  };
}
