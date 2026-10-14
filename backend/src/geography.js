export const BASE_CITY={name:'Hyderabad',latitude:17.45452,longitude:78.35008,radius_km:10};
// Golden-angle distribution. Most workers stay in the inner 3 km, so the demo origin always has nearby matches.
export function seedPosition(index){
 const angle=index*2.399963229728653;
 const radius=index%4===0?6+(index%5)*0.7:0.4+(index%12)*0.2;
 return {latitude:Number((BASE_CITY.latitude+Math.sin(angle)*radius/111.195).toFixed(6)),longitude:Number((BASE_CITY.longitude+Math.cos(angle)*radius/(111.195*Math.cos(BASE_CITY.latitude*Math.PI/180))).toFixed(6))};
}
