// ShareOut Charts SDK - Serve endpoint
// Compiled from sdk/src/charts.ts
import { SDK_IMMUTABLE_CACHE } from './sdk-version';

export function handleServeChartsSDK(request: Request, immutable = false): Response {
  const secFetchDest = request.headers.get('Sec-Fetch-Dest');
  const secFetchMode = request.headers.get('Sec-Fetch-Mode');

  if (secFetchDest === 'document' || secFetchMode === 'navigate') {
    return new Response('Forbidden', { status: 403 });
  }

  const sdkCode = getChartsSDK();
  return new Response(sdkCode, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': immutable ? SDK_IMMUTABLE_CACHE : 'public, max-age=300, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function getChartsSDK(): string {
  return `(function(){"use strict";
const DEFAULT_COLORS=["#3b82f6","#ef4444","#22c55e","#f59e0b","#8b5cf6","#ec4899","#14b8a6","#f97316","#06b6d4","#84cc16"];
const DEFAULT_PLOTLY_CDN="https://cdn.plot.ly/plotly-2.27.0.min.js";

class ShareOutCharts{
  constructor(options={}){
    this.charts=new Map();
    this.plotlyLoaded=false;
    this.plotlyPromise=null;
    this.refreshTimers=new Map();
    this.options={
      plotlyCDN:options.plotlyCDN||DEFAULT_PLOTLY_CDN,
      theme:options.theme||"light",
      defaultColors:options.defaultColors||DEFAULT_COLORS,
      animationDuration:options.animationDuration||500
    };
  }

  async loadPlotly(){
    if(this.plotlyLoaded)return;
    if(this.plotlyPromise)return this.plotlyPromise;
    this.plotlyPromise=new Promise((resolve,reject)=>{
      if(typeof window!=="undefined"&&window.Plotly){
        this.plotlyLoaded=true;
        resolve();
        return;
      }
      const script=document.createElement("script");
      script.src=this.options.plotlyCDN;
      script.async=true;
      script.onload=()=>{this.plotlyLoaded=true;resolve();};
      script.onerror=()=>reject(new Error("Failed to load Plotly"));
      document.head.appendChild(script);
    });
    return this.plotlyPromise;
  }

  getPlotly(){return window.Plotly;}

  configToPlotlyData(config){
    const colors=config.colors||this.options.defaultColors;
    return config.series.map((series,idx)=>{
      const type=series.type||config.type;
      const color=series.color||colors[idx%colors.length];
      const x=config.categories||series.data.map((d,i)=>typeof d==="object"?d.x:i);
      const y=series.data.map(d=>typeof d==="object"?d.y:d);
      const base={name:series.name,x,y,marker:{color}};
      switch(type){
        case"scatter":return{...base,type:"scatter",mode:"markers"};
        case"line":return{...base,type:"scatter",mode:"lines"};
        case"area":return{...base,type:"scatter",mode:"lines",fill:"tozeroy"};
        case"bar":return{...base,type:"bar"};
        case"pie":case"donut":return{name:series.name,labels:x,values:y,type:"pie",hole:type==="donut"?0.4:0,marker:{colors:colors.slice(0,y.length)}};
        case"heatmap":return{...base,type:"heatmap",z:series.data.map(d=>[typeof d==="object"?d.y:d])};
        case"funnel":return{...base,type:"funnel"};
        case"gauge":return{type:"indicator",mode:"gauge+number",value:y[0]||0,title:{text:series.name},gauge:{axis:{range:[0,Math.max(...y)*1.2]},bar:{color}}};
        default:return base;
      }
    });
  }

  configToPlotlyLayout(config){
    const isDark=this.options.theme==="dark"||(this.options.theme==="auto"&&typeof window!=="undefined"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
    return{
      title:config.title?{text:config.title}:undefined,
      showlegend:config.showLegend!==false,
      legend:config.legendPosition?{
        orientation:config.legendPosition==="top"||config.legendPosition==="bottom"?"h":"v",
        x:config.legendPosition==="left"?0:config.legendPosition==="right"?1:0.5,
        y:config.legendPosition==="top"?1.1:config.legendPosition==="bottom"?-0.1:0.5,
        xanchor:"center"
      }:undefined,
      xaxis:{title:config.xAxisLabel,showgrid:config.showGrid!==false,visible:config.showAxes!==false},
      yaxis:{title:config.yAxisLabel,showgrid:config.showGrid!==false,visible:config.showAxes!==false},
      paper_bgcolor:isDark?"#1f2937":"white",
      plot_bgcolor:isDark?"#111827":"white",
      font:{color:isDark?"#f3f4f6":"#1f2937"},
      margin:{t:config.title?50:30,r:30,b:50,l:50},
      barmode:config.stacked?"stack":undefined,
      height:typeof config.height==="number"?config.height:undefined,
      width:typeof config.width==="number"?config.width:undefined
    };
  }

  configToPlotlyConfig(config){
    return{responsive:config.responsive!==false,displayModeBar:false,staticPlot:false};
  }

  async create(elementOrId,config){
    await this.loadPlotly();
    const element=typeof elementOrId==="string"?document.getElementById(elementOrId):elementOrId;
    if(!element)throw new Error("Chart container not found: "+elementOrId);
    config._version=1;
    element.setAttribute("data-shareout-chart",JSON.stringify(config));
    element.setAttribute("data-chart-id",config.id);
    const Plotly=this.getPlotly();
    const data=this.configToPlotlyData(config);
    const layout=this.configToPlotlyLayout(config);
    const plotlyConfig=this.configToPlotlyConfig(config);
    await Plotly.newPlot(element,data,layout,plotlyConfig);
    this.charts.set(config.id,{config,plotly:element});
    if(config.dataBinding?.refreshInterval){
      this.startAutoRefresh(config.id,config.dataBinding.refreshInterval);
    }
  }

  async update(chartId,updates){
    const chart=this.charts.get(chartId);
    if(!chart)throw new Error("Chart not found: "+chartId);
    const newConfig={...chart.config,...updates,_version:(chart.config._version||0)+1};
    const element=chart.plotly;
    element.setAttribute("data-shareout-chart",JSON.stringify(newConfig));
    const Plotly=this.getPlotly();
    const data=this.configToPlotlyData(newConfig);
    const layout=this.configToPlotlyLayout(newConfig);
    await Plotly.react(element,data,layout);
    this.charts.set(chartId,{config:newConfig,plotly:element});
  }

  async updateData(chartId,series){return this.update(chartId,{series});}
  async setTitle(chartId,title){return this.update(chartId,{title});}
  async setType(chartId,type){return this.update(chartId,{type});}
  async setColors(chartId,colors){return this.update(chartId,{colors});}
  getConfig(chartId){return this.charts.get(chartId)?.config||null;}

  static parseFromElement(element){
    const configStr=element.getAttribute("data-shareout-chart");
    if(!configStr)return null;
    try{return JSON.parse(configStr);}catch{return null;}
  }

  async destroy(chartId){
    const chart=this.charts.get(chartId);
    if(!chart)return;
    this.stopAutoRefresh(chartId);
    const Plotly=this.getPlotly();
    await Plotly.purge(chart.plotly);
    this.charts.delete(chartId);
  }

  async destroyAll(){
    for(const chartId of this.charts.keys()){await this.destroy(chartId);}
  }

  startAutoRefresh(chartId,intervalMs){
    this.stopAutoRefresh(chartId);
    const timer=setInterval(()=>this.refreshData(chartId),intervalMs);
    this.refreshTimers.set(chartId,timer);
  }

  stopAutoRefresh(chartId){
    const timer=this.refreshTimers.get(chartId);
    if(timer){clearInterval(timer);this.refreshTimers.delete(chartId);}
  }

  async refreshData(chartId){
    const chart=this.charts.get(chartId);
    if(!chart?.config.dataBinding)return;
    const binding=chart.config.dataBinding;
    let newData=null;
    try{
      switch(binding.source){
        case"api":
          if(binding.apiUrl){
            const res=await fetch(binding.apiUrl);
            const json=await res.json();
            newData=this.transformApiData(json,binding);
          }
          break;
        case"table":
          if(window.ShareOut){
            const rows=await window.ShareOut.table(binding.tableName).list();
            newData=this.transformTableData(rows,binding);
          }
          break;
        case"json":
          if(window.ShareOut){
            const data=await window.ShareOut.json.get(binding.jsonKey);
            newData=this.transformJsonData(data,binding);
          }
          break;
      }
      if(newData)await this.updateData(chartId,newData);
    }catch(err){console.error("ShareOut Charts: refresh failed",err);}
  }

  transformApiData(data,binding){
    const items=Array.isArray(data)?data:[data];
    return this.transformTableData(items,binding);
  }

  transformTableData(rows,binding){
    const xCol=binding.xColumn||"x";
    const yCols=binding.yColumns||["y"];
    if(binding.groupBy&&binding.aggregation&&binding.aggregation!=="none"){
      const groups=new Map();
      for(const row of rows){
        const key=String(row[binding.groupBy]||"Unknown");
        if(!groups.has(key))groups.set(key,[]);
        for(const yCol of yCols){groups.get(key).push(Number(row[yCol])||0);}
      }
      const aggregated=new Map();
      for(const[key,values]of groups){
        switch(binding.aggregation){
          case"count":aggregated.set(key,values.length);break;
          case"sum":aggregated.set(key,values.reduce((a,b)=>a+b,0));break;
          case"avg":aggregated.set(key,values.reduce((a,b)=>a+b,0)/values.length);break;
          case"min":aggregated.set(key,Math.min(...values));break;
          case"max":aggregated.set(key,Math.max(...values));break;
        }
      }
      return[{name:binding.groupBy,data:Array.from(aggregated.entries()).map(([x,y])=>({x,y}))}];
    }
    return yCols.map(yCol=>({name:yCol,data:rows.map(row=>({x:row[xCol],y:Number(row[yCol])||0}))}));
  }

  transformJsonData(data,binding){
    if(Array.isArray(data))return this.transformTableData(data,binding);
    return[{name:"Value",data:[data]}];
  }
}

ShareOutCharts.templates={
  line:(id,title)=>({id,type:"line",title,series:[{name:"Series 1",data:[10,20,30,40,50]}],categories:["Jan","Feb","Mar","Apr","May"],showLegend:true,showGrid:true,responsive:true}),
  bar:(id,title)=>({id,type:"bar",title,series:[{name:"Category A",data:[30,45,25,60,35]},{name:"Category B",data:[20,35,40,30,45]}],categories:["Q1","Q2","Q3","Q4","Q5"],showLegend:true,responsive:true}),
  pie:(id,title)=>({id,type:"pie",title,series:[{name:"Distribution",data:[{x:"Category A",y:30},{x:"Category B",y:25},{x:"Category C",y:20},{x:"Category D",y:15},{x:"Category E",y:10}]}],showLegend:true,legendPosition:"right",responsive:true}),
  area:(id,title)=>({id,type:"area",title,series:[{name:"Traffic",data:[100,200,150,300,250,400]}],categories:["Mon","Tue","Wed","Thu","Fri","Sat"],showLegend:true,showGrid:true,responsive:true}),
  scatter:(id,title)=>({id,type:"scatter",title,series:[{name:"Dataset",data:[{x:1,y:10},{x:2,y:15},{x:3,y:8},{x:4,y:22},{x:5,y:18},{x:6,y:25}]}],showLegend:false,showGrid:true,responsive:true}),
  donut:(id,title)=>({id,type:"donut",title,series:[{name:"Distribution",data:[{x:"Complete",y:65},{x:"In Progress",y:25},{x:"Pending",y:10}]}],showLegend:true,legendPosition:"bottom",responsive:true}),
  gauge:(id,title,value=75)=>({id,type:"gauge",title,series:[{name:title||"Progress",data:[value]}],responsive:true}),
  kpi:(id,title,value,trend)=>({id,type:"gauge",title,series:[{name:title,data:[value]}],responsive:true,height:150})
};

if(typeof window!=="undefined"){window.ShareOutCharts=ShareOutCharts;}
})();`;
}
