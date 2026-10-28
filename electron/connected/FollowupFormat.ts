/** Owned generation constraint; independent post-generation verification remains required. */
export function followupFormat(){return {type:'object',properties:{summary:{type:'string'},
  tasks:{type:'array',minItems:1,items:{type:'string'}},unknowns:{type:'array',items:{type:'string'}}},
  required:['summary','tasks','unknowns'],additionalProperties:false};}
