export function yieldAxis(values,minimum=''){
 const data=values.filter(v=>typeof v==='number'&&Number.isFinite(v));
 const low=Math.min(99,...data),high=Math.max(100,...data);
 const manual=String(minimum??'').trim()!=='';if(manual&&(!Number.isFinite(Number(minimum))||Number(minimum)<0||Number(minimum)>=100))throw Error('Min scale은 0 이상 100 미만으로 입력하세요.');
 return {min:manual?Number(minimum):low<99?Math.max(0,Math.floor((low-0.1)*10)/10):99,max:high>100?Math.ceil((high+0.1)*10)/10:100,beginAtZero:false,title:{display:true,text:'Yield %'},ticks:{callback:v=>Number(v).toFixed(1)+'%'}};
}
export function yieldReferences(length){return [{label:'Yield Goal 99.9%',value:99.9,color:'#238b45',dash:[6,4]},{label:'Yield Limit 98%',value:98,color:'#d83a3a',dash:[4,3]}].map(r=>({type:'line',label:r.label,data:Array(length).fill(r.value),borderColor:r.color,backgroundColor:r.color,borderDash:r.dash,borderWidth:2,pointRadius:0,pointHitRadius:0,order:-1,referenceValue:r.value}));}
// Full chart width also covers charts with only one weekly category.
export const referenceLines={id:'yieldReferenceLines',afterDatasetsDraw(chart){const {ctx,chartArea:a,scales:{y}}=chart;if(!a||!y)return;ctx.save();chart.data.datasets.forEach((ds,i)=>{if(ds.referenceValue===undefined||!chart.isDatasetVisible(i)||ds.referenceValue<y.min||ds.referenceValue>y.max)return;const py=y.getPixelForValue(ds.referenceValue);ctx.beginPath();ctx.strokeStyle=ds.borderColor;ctx.lineWidth=2;ctx.setLineDash(ds.borderDash||[]);ctx.moveTo(a.left,py);ctx.lineTo(a.right,py);ctx.stroke();});ctx.restore();}};
