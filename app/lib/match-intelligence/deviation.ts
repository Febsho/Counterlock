export type BuildDeviation={normalNextItemId:number|null;candidateItemId:number;delayedItems:number[];soulDelayCost:number;flowTransitionPenalty:number;slotPressurePenalty:number;powerSpikeDelay:number;totalDeviationCost:number};
export type PowerSpike={itemId:number;score:number;estimatedSoulsRemaining:number|null;currentProgress:number;reason:string};
export function buildDeviation(input:Omit<BuildDeviation,"totalDeviationCost">):BuildDeviation{return {...input,totalDeviationCost:Math.max(0,input.soulDelayCost+input.flowTransitionPenalty+input.slotPressurePenalty+input.powerSpikeDelay)}}
export function shouldPreservePowerSpike(spike:PowerSpike|null, urgency:number):boolean{return !!spike && (spike.estimatedSoulsRemaining??Infinity)<=1200 && urgency<.82}
