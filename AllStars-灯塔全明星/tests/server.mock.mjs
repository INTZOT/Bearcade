export const system={currentTick:0,run:fn=>fn(),runTimeout:()=>0,runInterval:()=>0,clearRun:()=>{}};
export const world={getDynamicProperty:()=>undefined,sendMessage:()=>{},getAllPlayers:()=>[],scoreboard:{},afterEvents:{},beforeEvents:{},primitiveShapesManager:{texts:new Set(),addText(shape){this.texts.add(shape)},removeText(shape){this.texts.delete(shape)}}};
const enumeration=new Proxy({}, {get:(_,key)=>key});
export const InputPermissionCategory=enumeration,EntityComponentTypes=enumeration,GameMode=enumeration,InputButton=enumeration,ButtonState=enumeration,EasingType=enumeration,ItemLockMode=enumeration;
export const HudElement=enumeration,HudVisibility=enumeration;
export class BlockVolume {}
export class ItemStack {setLore() {}}
export class MolangVariableMap {values={};setFloat(name,value){this.values[name]=value} setVector3(name,value){this.values[name]=value} setColorRGB(){} setColorRGBA(){}}
export class TextPrimitive {constructor(location,text){this.location=location;this.text=text}setLocation(location){this.location=location}setText(text){this.text=text}}
export class ActionFormData {title(){return this} body(){return this} button(){return this}}
export class ModalFormData {}
export class MessageFormData {}
export const CameraShakeType=enumeration,CommandPermissionLevel=enumeration,CustomCommandStatus=enumeration;
export class Player {}
export class CustomForm {}
