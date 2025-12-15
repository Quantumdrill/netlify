import * as THREE from "three"
import {pointLight,directionalLight} from "./light.js"
import Model from "./model.js"
import { texture } from "three/tsl"
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import {manager} from "./manager.js"
import { getBoneIndex, create3JointIK, orientConstraint, pointConstraint, aimConstraint, getSkinnedMeshSkeleton, poleVectorConstraint } from "./functions.js"
import {gsap} from "gsap"

const scene = new THREE.Scene()
const renderer = new THREE.WebGLRenderer({antialias:true})
const fov = 23
const cam = new THREE.PerspectiveCamera(fov, window.innerWidth/window.innerHeight,0.1,1000)
cam.position.set(0,13,15)
const clock = new THREE.Clock()
const loadingManager = manager()
const modelLoader = new FBXLoader(loadingManager);
const char = {}
const lights = {}
const anims = {}
const mixers = []

function init(){
    renderer.setSize(window.innerWidth, window.innerHeight)
    document.body.appendChild(renderer.domElement)

    lights.key = directionalLight({x:-5,y:5,z:5})
    scene.add(lights.key)

    // char rig model load
    modelLoader.load("/rig_righthandPosed.fbx",(loaded)=>{
        char.mesh = loaded
        const charMat = new THREE.MeshPhongMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 0.04,
            flatShading: true,
            specular: 0xffffff,
            shininess: 5
        })
        getSkinnedMeshSkeleton(char.mesh)
        char.mesh.skinnedMesh.material = charMat
        scene.add(char.mesh)

        char.IkSolver = create3JointIK(char.mesh.skinnedMesh,char.mesh.skeleton,["ikHandle","hand_R","elbow_R","shoulder_R"])

        //assign important bones
        char.ikHandle = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"ikHandle")]
        char.rootBone = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"root")]
        char.shoulder = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"shoulder_R")]
        char.elbow = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"elbow_R")]
        char.hand = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"hand_R")]
        char.shoulderParent = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"spine2")]
        char.spine1 = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"spine1")]
        char.hip = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"hip")]
        char.hip.restPos = char.hip.getWorldPosition(new THREE.Vector3())
        char.head = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"head")]
        char.neck = char.mesh.skeleton.bones[getBoneIndex(char.mesh.skeleton,"neck")]

    })

    //run after fbx is loaded
    loadingManager.onLoad = ()=>{
        console.log("loaded")

        char.pv = new THREE.Object3D()
        char.pv.position.y = -15

        //mouse interaction
        anims.charToCamDist = cam.position.z
        anims.charToPointerHoverDist = 1.3
        anims.pointerClickDist = 1
        anims.planeToCamDist = anims.charToCamDist - anims.charToPointerHoverDist - anims.pointerClickDist
        anims.wristToFingerTipDist = 1.9
        anims.camHeight = cam.position.y
        anims.curserToPointerMultiplier = Math.tan(fov/2/180*Math.PI)*(anims.planeToCamDist)
        anims.wristRefBaseZ = -2
        anims.wristRefBase = new THREE.Vector3(-2,6,anims.wristRefBaseZ) // a point in the back of the character, the line between the fingertip and this is used to determine the orientation and the position of the wrist
        anims.pointerHoverZ = anims.charToPointerHoverDist
        anims.pointerZ = anims.pointerHoverZ
        anims.pointerPos = new THREE.Vector3(0,0,anims.pointerHoverZ)
        document.addEventListener("mousemove",e=>{
            anims.x = (e.clientX/window.innerWidth*2-1)*(window.innerWidth/window.innerHeight) // get x position -1*ratio to 1*ratio
            anims.y = -(e.clientY/window.innerHeight*2-1) // get y position: -1 to 1
            anims.pointerY = anims.y*anims.curserToPointerMultiplier + anims.camHeight
            anims.pointerX = anims.x*anims.curserToPointerMultiplier
            anims.pointerPos.setComponent(0,anims.pointerX)
            anims.pointerPos.setComponent(1,anims.pointerY)

            //fk rotation mapping
            char.hip.rotation.y = (anims.x+0.2)*0.1
            char.hip.position.x = char.hip.restPos.y+(Math.abs(anims.x+0.2)+anims.y)*0.7
            char.spine1.rotation.y = (anims.x+0.2)*0.15
            char.spine1.rotation.x = (anims.x+1)*0.2
            char.pv.position.x = (anims.x-1)*2
            char.pv.position.z = (anims.x+2)*3
            char.pv.position.y = (anims.y+anims.x)*5
            char.head.rotation.z = (anims.y)*0.3
            char.head.rotation.x = (anims.x)*0.1

            clickWristUpdate()
        })
        anims.tlDown = {isActive:()=>{return false}}
        anims.tlUp = {isActive:()=>{return false}}
        anims.clickDuration = 0.1
        anims.releasable = false
        document.addEventListener("mousedown",e=>{
            anims.mousedown = true
        })
        document.addEventListener("mouseup",e=>{
            anims.mousedown = false
        })
        anim()
    }
}

function clickWristUpdate(){
    anims.wristRefLine = new THREE.Vector3().subVectors(anims.wristRefBase,anims.pointerPos) // line from fingertip to the wristRefBase
    anims.fingerTipToWristVec = new THREE.Vector3().copy(anims.wristRefLine).setLength(anims.wristToFingerTipDist)
    anims.wristToFingerTipVec = new THREE.Vector3().copy(anims.fingerTipToWristVec).negate()
    anims.wristCurrentZ = char.hand.getWorldPosition(new THREE.Vector3()).z
    anims.newWristPos = new THREE.Vector3().addVectors(anims.pointerPos,anims.fingerTipToWristVec)
    pointConstraint(anims.newWristPos,char.ikHandle,char.rootBone)
    
    anims.wristUpV = new THREE.Vector3().crossVectors(new THREE.Vector3(-1,0,0),anims.wristToFingerTipVec).normalize()
    aimConstraint(char.hand,anims.wristToFingerTipVec,anims.wristUpV,char.elbow,true,new THREE.Vector3(-7,1,0.5),anims.wristUpV)
}

function clickPokeAnim(){
    if (!anims.tlUp.isActive()&&!anims.tlDown.isActive()&&anims.mousedown === true&&anims.releasable === false){ 
        anims.releasable = true // releasable is used to make sure the poke anim is fired only once
        anims.tlDown = gsap.timeline()
        anims.tlDown.to(char.ikHandle.position,{
            y: "-="+anims.pointerClickDist*0.7,
            duration: anims.clickDuration
        }).to(anims,{
            wristRefBaseZ: "+="+anims.pointerClickDist,
            duration: anims.clickDuration,
        },"<").to(anims,{
            pointerZ: "+="+anims.pointerClickDist,
            duration: anims.clickDuration
        },"<")
        anims.tlDown.eventCallback("onUpdate", () => {
            anims.wristRefBase.setComponent(2,anims.wristRefBaseZ)
            anims.pointerPos.setComponent(2,anims.pointerZ)
            clickWristUpdate()
        })
    }
    if (!anims.tlUp.isActive()&&!anims.tlDown.isActive()&&anims.mousedown === false&&anims.releasable === true){
        anims.releasable = false
        anims.tlUp = gsap.timeline()
        anims.tlUp.to(char.ikHandle.position,{
            y: "+="+anims.pointerClickDist*0.7,
            duration: anims.clickDuration
        }).to(anims,{
            wristRefBaseZ: "-="+anims.pointerClickDist,
            duration: anims.clickDuration
        },"<").to(anims,{
            pointerZ: "-="+anims.pointerClickDist,
            duration: anims.clickDuration
        },"<")
        anims.tlUp.eventCallback("onUpdate", () => {
            anims.wristRefBase.setComponent(2,anims.wristRefBaseZ)
            anims.pointerPos.setComponent(2,anims.pointerZ)
            clickWristUpdate()
        })
    }
}

function anim(){
    const delta = clock.getDelta()
    for (const mixer of mixers){
        mixer.update(delta)
    }
    
    poleVectorConstraint(char.ikHandle,char.hand,char.elbow,char.shoulder,char.pv,char.shoulderParent,new THREE.Euler())
    char.IkSolver.update()
    clickPokeAnim()

    renderer.render(scene,cam)
    requestAnimationFrame(anim)
}

init()
