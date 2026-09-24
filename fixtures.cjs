const rect=(x,y,width,height)=>({x,y,width,height});
const base={pipeStepMm:150,pipeDiameterMm:16,wallOffsetMm:100,maxCircuitLengthMm:100000};
const cases=[
 ['rectangle',[rect(0,0,4000,3000)],[],[600,3000,'bottom']],
 ['L',[rect(0,0,3500,5000),rect(3500,0,2500,2500)],[],[600,5000,'bottom']],
 ['T',[rect(0,0,5000,2000),rect(1500,2000,2000,3000)],[],[2000,5000,'bottom']],
 ['U',[rect(0,0,1500,4500),rect(1500,3000,2000,1500),rect(3500,0,1500,4500)],[],[600,4500,'bottom']],
 ['corner-cut',[rect(0,0,4000,1800),rect(0,1800,2700,1200)],[],[600,3000,'bottom']],
 ['multiple-cuts',[rect(1000,0,3000,1200),rect(0,1200,5000,2300),rect(1200,3500,2500,1500)],[],[2000,5000,'bottom']],
 ['central-obstacle',[rect(0,0,5000,4000)],[rect(2000,1500,800,800)],[600,4000,'bottom']],
 ['wall-obstacle',[rect(0,0,4000,3500)],[rect(0,1200,700,1000)],[600,3500,'bottom']],
 ['two-obstacles',[rect(0,0,6000,4500)],[rect(1500,1500,600,700),rect(3900,2400,700,700)],[600,4500,'bottom']],
 ['narrow-passage',[rect(0,0,2600,3600),rect(2600,1300,1400,1000),rect(4000,0,2600,3600)],[],[600,3600,'bottom']],
 ['large-rectangle',[rect(0,0,8000,6000)],[],[600,6000,'bottom']],
 ['compact-central-obstacle',[rect(0,0,4000,3000)],[rect(1700,1100,600,600)],[600,3000,'bottom']]
];
module.exports=cases.map(([name,sections,obstacles,[x,y,side]])=>({name,input:{...base,sections,obstacles,supply:{x,y,side},returnPoint:{x:x+50,y,side}}}));
