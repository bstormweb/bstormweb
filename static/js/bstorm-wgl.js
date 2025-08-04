"use strict";

var xhttp;
if (window.XMLHttpRequest) {
   xhttp = new XMLHttpRequest();
} else {    // IE 5/6
   xhttp = new ActiveXObject("Microsoft.XMLHTTP");
}

var gl; // A global variable for the WebGL context

var m4; // matrix math from twgl

var programInfo;
var arrays = {
	position: [-1, -1, 0,
				1, -1, 0,
				-1, 1, 0,
				-1, 1, 0,
				 1, -1, 0,
				 1, 1, 0],
    // position: [-0.9, -0.9, 0.0,
    // 	        0.9, -0.9, 0.0,
    // 	       -0.9,  0.9, 0.0,

    // 	       -0.9,  0.9, 0.0,
    //             0.9, -0.9, 0.0,
    //             0.9,  0.9, 0.0 ],

    st: [  0.0, 1.0, 0.0,
           1.0, 1.0, 0.0,
           0.0, 0.0, 0.0,

           0.0, 0.0, 0.0,
           1.0, 1.0, 0.0,
           1.0, 0.0, 0.0  ]
   };
// var arrays = {
//   position: [-1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0],
//};

var stopCount = 0;

var u_transformWorld;

var worldInverse;

var bstormBufferInfo;

var textures;
var wordTexture;

var wheels = null;

var wheelSize = 0.84;

// Meta Info
var title = "Brainstormer";
var creator = "";
var desc = "";

var grabbedWheel = -1;

var lastTime = 0.0;

var glcanvas = null;

var zoomLevel = 1.0;
var offsetX = 0.0;
var offsetY = 0.0;
var fitHoriz = true;

// -----------------------------------------------------------
var bstormVertexSource = `

uniform mat4 u_transform;
attribute vec4 position;
attribute vec2 st;

varying vec2 stVarying;

void main() {
	stVarying = st;
  	gl_Position = u_transform * position;
}`;


var bstormFragmentSource = `

precision mediump float;

uniform vec2 resolution;
uniform float time;
uniform sampler2D u_texture;

varying vec2 stVarying;

void main() {
   vec2 uv = gl_FragCoord.xy / resolution;
  // float color = 0.0;

  gl_FragColor = texture2D( u_texture, stVarying );
  //gl_FragColor.a = max( 0.1, gl_FragColor.a );

  //gl_FragColor = vec4( stVarying.x, stVarying.y, 0.5, 1.0 );
}`;

// -----------------------------------------------------------
// Wheel Class
function Wheel( wordlist, numSegments, wordCapacity, divId ) {
	this.wordlist = wordlist
	this.angle = 0.0
	this.lastAngle = 0.0
	this.wordAng = 360.0 / wordlist.length
	this.wordCapacity = wordCapacity
	this.grabbed = false

	this.grabStartAngle = 0.0;
	this.dragStartAngle = 0.0;

	this.innerRadius = 0.0
	this.outerRadius = 1.0

	this.wordElem = document.getElementById( divId );

	this.bufferData = null;
	this.numSegments = numSegments;

	this.dbgSpinRate = 0.001;

	// used for drawing
	this.uniforms = null;
	this.wheelBufferInfo = null;
	this.transformWheel = m4.identity();

	this.velHistory = [];

	this.dbgMaxVel = 0.0;
	this.needsSnap = false;

	// Initialize velHistory array
	var VEL_HISTORY_SZ = 5;
	while (this.velHistory.length < VEL_HISTORY_SZ) {
		this.velHistory.push( 0.0 );
	}


	this.buildWheelGeom = function( innerRadius, outerRadius ) {
		//console.log("Build wheel geom " + innerRadius +" "+ outerRadius );

		//this.wheelBufferInfo = twgl.createBufferInfoFromArrays(gl, arrays);
		this.innerRadius = innerRadius;
		this.outerRadius = outerRadius;

		// Adjustments
		var posData = []
		var stData = []

		for (var i=0; i < this.numSegments; i++)
        {
        	var i2 = i;
        	if (i == this.numSegments-1) {
        		i2 = 0;
        	}
            var t = ( i2 / (this.numSegments-1)) * 2.0 * Math.PI;
            var s = Math.sin(t);
            var c = Math.cos(t);

            var s2 = s * 0.5;
            var c2 = c * 0.5;

            // Inner rad
            posData.push( c * innerRadius * wheelSize ); // pos x
            posData.push( s * innerRadius * wheelSize ); // pos y
            posData.push( 0.0 ); // pos z

            stData.push( (c2 * innerRadius) + 0.5); // st s
            stData.push( 1.0 - ((s2 * innerRadius) + 0.5)); // st t
            stData.push( 0.0 );

            // Outer rad
            posData.push( c * outerRadius * wheelSize );
            posData.push( s * outerRadius * wheelSize );
            posData.push ( 0.0 );

            stData.push( (c2 * outerRadius) + 0.5);
            stData.push( 1.0 - ((s2 * outerRadius) + 0.5) );
            stData.push( 0.0 );
        }

        this.wheelBufferInfo = twgl.createBufferInfoFromArrays(gl,
        							{ position: posData, st: stData } );

	}

	this.updateWheelPhysics = function ( dt ) {

		// Use average velocity
		var angVel = 0.0;
		for (var i =0; i < this.velHistory.length; ++i)
		{
			angVel += this.velHistory[i];
		}
		angVel /= this.velHistory.length;


		// if (Math.abs(angVel) > 0.0) {
		// 	console.log("ZZavgVel is " + angVel + " velHistory is " + this.velHistory );
		// }

		// simple drag ( see BSWheel.m for unused "better drag") formula
		// var oldVel = angVel;
		angVel -= angVel * 0.10;

		var clampedAngVel = angVel;
		// Clamp velocity at MAXVEL, but don't change
		// real vel to make momentum feel better
		var maxVel = 1000.0;
		if (clampedAngVel > maxVel) {
			clampedAngVel = maxVel;
		} else if (clampedAngVel < -maxVel) {
			clampedAngVel = -maxVel;
		}

		var rotAmount = clampedAngVel * dt;
		this.angle += rotAmount;

		// Check Snap (kMIN_VEL = 3.0)
		var absVel = Math.abs(angVel);

		if (absVel > this.dbgMaxVel) {
			this.dbgMaxVel = absVel;
		}

		if ((grabbedWheel<0) && (this.needsSnap) && ( absVel < 3.0)) {
			this.snapNearestWord();
			//console.log("Snapped: max vel was " + this.dbgMaxVel );
			this.dbgMaxVel = 0.0;
			this.needsSnap = false;
		}

	}

	this.updateWheel = function( dt ) {

		var angVel = (this.angle - this.lastAngle) / dt;
		this.lastAngle = this.angle;

		// // Clamp velocity at MAXVEL
		// var maxVel = 1000.0;
		// if (angVel > maxVel) {
		// 	angVel = maxVel;
		// } else if (angVel < -maxVel) {
		// 	angVel = -maxVel;
		// }

		// add to velocity history
		for (var i=1; i < this.velHistory.length; ++i)
		{
			this.velHistory[i] = this.velHistory[i-1];
		}
		this.velHistory[0] = angVel;
		//console.log("momentary angVel " + angVel + " HIST: " + this.velHistory[0] );

		// Update physics if we're not grabbing the wheel
		if (grabbedWheel < 0) {
			this.updateWheelPhysics( dt );
		}

		// Update the wheel's transform
		this.transformWheel = m4.rotationZ( this.angle * (Math.PI / 180.0) )
	}

	this.drawWheel = function( dt, transformWorld ) {

		if (!this.uniforms) {
			this.uniforms = {
				resolution: [gl.canvas.width, gl.canvas.height],
				u_texture : wordTexture
			}
		}

		this.uniforms.time += dt;
		this.uniforms.u_transform = m4.multiply( transformWorld, this.transformWheel );

		twgl.setBuffersAndAttributes(gl, programInfo, this.wheelBufferInfo);
		twgl.setUniforms(programInfo, this.uniforms );
		twgl.drawBufferInfo(gl, this.wheelBufferInfo, gl.TRIANGLE_STRIP );
	}

	// this.grabWheel( x, y ) {

	// }



	this.wordIndexFromAngle = function( ang ) {
		var normAng = ang % 360.0;
		//console.log("normAng is " + normAng )
		var snappedAngle = (normAng + (this.wordAng * 0.5)) / 360.0;
		//console.log("snappedAngle is " + snappedAngle )
		var wordIndex = Math.floor(snappedAngle * this.wordCapacity) % this.wordCapacity
		//console.log("wordIndex is " + wordIndex )

		return wordIndex;
	}

	this.snapNearestWord = function() {
		var normAng = this.angle
		while (normAng < 0) {
			normAng += 360
		}
		normAng = normAng % 360

		var wordIndex = this.wordIndexFromAngle( normAng );
		var snappedAngle = wordIndex * this.wordAng;

		var diff = normAng - snappedAngle;
		this.angle -= diff;

		this.resetVelocity();

		if (this.wordElem) {
			this.wordElem.innerHTML = this.wordlist[ wordIndex ];
		}
	}

	this.resetVelocity = function() {
		this.lastAngle = this.angle;
		for (var i=0; i < this.velHistory.length; ++i)
		{
			this.velHistory[i] = 0.0;
		}
	}

	this.grabWheel = function( grabAngle ) {
		this.grabStartAngle = grabAngle;
		this.dragStartAngle = this.angle;

		this.resetVelocity();
	}

	this.dragWheel = function( dragAngle ) {
		var updAngle = this.dragStartAngle + (dragAngle - this.grabStartAngle);
		this.angle = updAngle;
		// console.log("dragWheel: dragStartAngle " + this.gragStartAngle +
		// 		               " dragAngle " + this.dragAngle +
		// 		               " grabStart " + this.grabStartAngle +
		// 		               " result " + updAngle );
	}

	this.randomSpin = function() {

		// TODO: handle locked wheels
		//if (_locked) return; // No interaction for locked wheels

		var kMINRANDVEL = 20.0;
		var kMAXRANDVEL = 60.0;
		var randomVel = ( Math.random() - 0.5) * (kMAXRANDVEL*2);
		if (Math.abs(randomVel) < kMINRANDVEL) {
			if (randomVel < 0.0) {
				randomVel = -kMINRANDVEL;
			} else {
				randomVel = kMINRANDVEL;
			}
		}

		for (var i=0; i < this.velHistory.length; ++i)
		{
			this.velHistory[i] = randomVel;
		}

		this.angle = this.angle + randomVel;
		this.needsSnap = true;
	}
}


// -----------------------------------------------------------
var mouseDown = false;

function screenToWheelCoords( x, y ) {

	// FIXME: this doesn't work if the div is resized



	var pp = [ (2.0 * (x / glcanvas.width)) - 1.0,
	           -((2.0 * (y / glcanvas.height)) - 1.0), 0.0 ]

	var ppWheel = m4.transformPoint( worldInverse, pp );
	console.log("Screen " + pp + "  wheel " + ppWheel );

	return ppWheel;
}

function wheelCoordsToAngle( x, y ) {
	var rawAngle = Math.atan2( y, x ) * (180.0 / Math.PI);
	if (rawAngle < 0.0) {
		rawAngle += 360.0;
	}
	return rawAngle;
}

function handleMouseDown(event) {

	//console.log("In handleMouseDown");

	if (!glcanvas) return;


	// reset the stop count
	if (stopCount>=1000) {
		stopCount = 0;
		requestAnimationFrame( bstorm_redraw );
	}


    mouseDown = true

    // Wheel coords are -1,-1 to 1,1 and have 0,0 centered at wheel
    var wheelPos = screenToWheelCoords( event.layerX, event.layerY )


    var grabRadius = Math.sqrt( wheelPos[0]*wheelPos[0] + wheelPos[1]*wheelPos[1]) / wheelSize;
	console.log("Wheel Pos: " + wheelPos + " radius " + grabRadius );

    if (wheels) {
		// Check if the "random spin" button is pressed. Hardcoded button pos for now
		var btnOffs = [ wheelPos[0] - 0.1279, wheelPos[1] + 0.1475 ]

		var btnDist = Math.sqrt( btnOffs[0]*btnOffs[0] + btnOffs[1]*btnOffs[1] )

		var angle = wheelCoordsToAngle( wheelPos[0], wheelPos[1] );
		if (btnDist < 0.07866) {
			randomSpinAll();

			// This angle check makes sure the grab angle is in the exposed part of the wheel mask
		} else if ((angle <75.0) || (angle > 275.0)) {
	    	for (var i=0; i < wheels.length; i++) {

	    		if ( (wheels[i].innerRadius < grabRadius) &&
	    			 (wheels[i].outerRadius > grabRadius) ) {
	    			//console.log( "Grab wheel " + i );
	    			grabbedWheel = i;
	    			wheels[i].grabWheel( angle );
	    		}
	    		// else {
	    		// 	console.log( "Didn't grab "+i+" " + [ wheels[i].innerRadius, wheels[i].outerRadius ])
	    		// }
	    	}
	    }
	}
  }

  function randomSpinAll() {
  	for (var i=0; i < wheels.length; i++) {
  		wheels[i].randomSpin();
  	}
  }

  function handleMouseUp(event) {
  	if (!glcanvas) return;

    mouseDown = false;

    if (grabbedWheel >= 0) {
    	wheels[grabbedWheel].needsSnap = true;
    }

	grabbedWheel = -1;

    var wheelPos = screenToWheelCoords( event.layerX, event.layerY );

  }

  function handleMouseMove(event) {
  	if (!glcanvas) return;

    if (!mouseDown) {
       return;
    }

    var wheelPos = screenToWheelCoords( event.layerX, event.layerY );
    //console.log("Mouse Move " + wheelPos[0] + "  " + wheelPos[1] );

    // console.log( "Mouse move "+ event.clientX + "  " + event.clientY );

    if (grabbedWheel >= 0) {
    	var angle = wheelCoordsToAngle( wheelPos[0], wheelPos[1] );

    	//wheels[grabbedWheel].angle = wheels[grabbedWheel].grabAngle + angle;
    	wheels[grabbedWheel].dragWheel( angle );
    	//console.log("Setting angle, grabAngle " + wheels[grabbedWheel].grabAngle + " angle  " + angle );
    }
}

function bstorm_redraw( time )
{

	twgl.resizeCanvasToDisplaySize(gl.canvas);
	gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

	//u_transformWorld = m4.identity();
	// zoomLevel = 1.0 + Math.sin(time*0.0001) * 0.5;
	// var xlate = m4.translation( [ Math.sin(time*0.00011) * 0.5, Math.cos(time*0.000141) * 0.5, 0.0] );

	// zoomLevel = 2.0;
	var aspect = gl.canvas.width / gl.canvas.height;

	var xlate = m4.translation( [ offsetX, offsetY, 0.0] );
	if (fitHoriz) {
		var zoomAspect = [zoomLevel, zoomLevel*aspect, 1.0];
	} else {
		var zoomAspect = [zoomLevel / aspect, zoomLevel, 1.0];
	}
	u_transformWorld = m4.multiply( m4.scaling( zoomAspect ), xlate  );

	//worldInverse = u_transformWorld
	worldInverse = m4.inverse( u_transformWorld )
	//worldInverse = m4.copy( u_transformWorld )

	var uniformsBG = {
		time: time * 0.001,
		resolution: [gl.canvas.width, gl.canvas.height],
		u_texture : textures.background,
		u_transform : u_transformWorld,
	};

	var uniformsMask = {
		time: time * 0.001,
		resolution: [gl.canvas.width, gl.canvas.height],
		u_texture : textures.wheelmask,
		u_transform : u_transformWorld
	};


	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	gl.useProgram(programInfo.program );
	twgl.setBuffersAndAttributes(gl, programInfo, bstormBufferInfo);

	twgl.setUniforms(programInfo, uniformsBG );
	twgl.drawBufferInfo(gl, bstormBufferInfo);

	if (wheels)
	{
		// Times are in ms, dt is in d(s)
		var dt = (time - lastTime) / 1000.0;
		lastTime = time;

		for (var i=0; i < wheels.length; i++) {
			wheels[i].updateWheel( dt );
			wheels[i].drawWheel( dt, u_transformWorld );
		}

	}

	twgl.setBuffersAndAttributes(gl, programInfo, bstormBufferInfo);
	twgl.setUniforms(programInfo, uniformsMask);
	twgl.drawBufferInfo(gl, bstormBufferInfo);


	stopCount += 1;
	if (stopCount < 1000) {
		requestAnimationFrame( bstorm_redraw );
	}
}

function bstorm_draw_words( canvas, wheelPos, wordList )
{

	var ctx = canvas.getContext('2d');

	ctx.fillStyle = "#333333";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = "24px Arial";

/*
	ctx.strokeStyle="red";
	ctx.lineWidth = 4.0;
	ctx.rect( 1, 1, canvas.width-2, canvas.height-2);
	ctx.stroke();


	// draw some filler to make it not-empty for testing
	for (var i=0; i < 500; i++) {
		ctx.beginPath();
		ctx.arc( Math.random() * canvas.width, Math.random() * canvas.height,
			     (Math.random() * 15.0) + 10.0, 0.0, Math.PI * 2.0, true );
		ctx.fill();
	}
*/
	var numWords = wordList.length;
	var step = (Math.PI/180.0) * (360.0 / numWords);
	ctx.textAlign = 'left';
	for (var i=0; i < numWords; i++) {
		ctx.save()
		ctx.translate(canvas.width/2, canvas.height/2);
		ctx.rotate( step * i );
		ctx.fillText( wordList[i], wheelPos, 0.0 );
		ctx.restore();
	}

}

function getXmlValue( xmlDoc, tagname, defvalue) {
	var tags = xmlDoc.getElementsByTagName(tagname);
	if (tags.length) {
		return tags[0].textContent;
	} else {
		return defvalue;
	}
}

function getXmlWords( wheelTag )
{
	var wordTags = wheelTag.getElementsByTagName("word")
	var resultWords = [];

	for (var i=0, len = wordTags.length; i < len; i++ ) {
		resultWords.push(wordTags[i].textContent);
	}


	//console.log( resultWords );
	return resultWords;
}

/* setup brainstormer after all word info has been loaded */
function setup_bstorm( canvas, xmlWheelInfo )
{

	// Set up mouse handlers
	canvas.onmousedown = handleMouseDown;
    document.onmouseup = handleMouseUp;
    document.onmousemove = handleMouseMove;

	// Draw the word list on the canvas and create a texture from it
	var wordCanvas = document.getElementById('bstorm_words');

	// title = xmlWheelInfo.getElementsByTagName("title")[0].textContent()
	title = getXmlValue( xmlWheelInfo, "title", title );
	creator = getXmlValue( xmlWheelInfo, "creator", creator );
	desc = getXmlValue( xmlWheelInfo, "desc", desc );
	// console.log( "title: " + title )
	// console.log( "creator: " + creator )
	// console.log( "desc: " + desc )

	var xmlWheels = xmlWheelInfo.getElementsByTagName("wheel");
	if (xmlWheels.length != 3) {
		console.log( "WARNING: expected 3 wheel tags, got " + xmlWheels.length )
	}

	var innerWords = getXmlWords( xmlWheels[0] );
	var middleWords = getXmlWords( xmlWheels[1] );
	var outerWords = getXmlWords( xmlWheels[2] );

	bstorm_draw_words( wordCanvas, 256.0, innerWords );
	bstorm_draw_words( wordCanvas, 560.0, middleWords );
	bstorm_draw_words( wordCanvas, 775.0, outerWords );

	wordTexture = twgl.createTexture( gl, { src:wordCanvas, min: gl.LINEAR_MIPMAP_LINEAR } );

	// Create wheels
	var wheelInner = new Wheel( innerWords, 100, 45, "bstorm_inner" );
	wheelInner.buildWheelGeom( 0.05, 0.52 );

	var wheelMiddle = new Wheel( middleWords, 200, 120, "bstorm_middle" );
	wheelMiddle.buildWheelGeom( 0.521, 0.74 );
	wheelMiddle.dbgSpinRate = 0.002;

	var wheelOuter = new Wheel( outerWords, 300, 180, "bstorm_outer" );
	wheelOuter.buildWheelGeom( 0.742, 1.0 );
	wheelOuter.dbgSpinRate = 0.5;

	wheels = [ wheelInner, wheelMiddle, wheelOuter ];

	// Initialize shaders
	programInfo = twgl.createProgramInfo( gl, [ bstormVertexSource, bstormFragmentSource ] );
	//programInfo = twgl.createProgramInfo(gl, ["vs", "fs"]);

	bstormBufferInfo = twgl.createBufferInfoFromArrays(gl, arrays);

	// Set clear color to black, fully opaque
	//gl.clearColor( 0.43, 0.40, 0.38, 1.0);
	gl.clearColor( 0.0, 0.0, 0.38, 1.0);
	// Enable depth testing
	//gl.enable(gl.DEPTH_TEST);
	// Near things obscure far things
	//gl.depthFunc(gl.LEQUAL);
	// Clear the color as well as the depth buffer.
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	gl.enable( gl.BLEND );
	gl.blendFunc( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA );


	requestAnimationFrame( bstorm_redraw );
}

function resetStopCount() {
	if (stopCount>=1000) {
		requestAnimationFrame( bstorm_redraw );
	}
	stopCount = 0;
}

function bstorm_setZoomLevel( zoom ) {
	zoomLevel = zoom;
	resetStopCount()
}

function bstorm_setOffsetX( offsX ) {
	offsetX = offsX;
	resetStopCount()
}

function bstorm_setOffsetY( offsY ) {
	offsetY = offsY;
	resetStopCount()
}

function bstorm_setFitHoriz( doFitHoriz ) {
	fitHoriz = doFitHoriz;
	resetStopCount()
}


function bstorm_main( wheelSet )
{
	var canvas = document.getElementById("glcanvas");

	// Initialize the GL context
	gl = twgl.getWebGLContext( canvas );
	m4 = twgl.m4;

	// Only continue if WebGL is available and working
	if (!gl) {
		return;
	}

	console.log("Wheelset is ", wheelSet )
	if (wheelSet === undefined) {
		wheelSet = "/wheels/bstorm.xml";
	}

	// Fetch wheel XML
	xhttp.overrideMimeType('text/xml');
	xhttp.onreadystatechange = function() {
    	var xmlDoc = this.responseXML;
    	if (this.readyState == 4 && this.status == 200) {
    		//console.log( "fetched wheel xml state: " + this.readyState + " response " + xmlDoc )
    		setup_bstorm( canvas, xmlDoc );
    	}
	}

	xhttp.open("GET", wheelSet, true);
	xhttp.send(null);

	// Match display size
	twgl.resizeCanvasToDisplaySize( gl.canvas );
	gl.viewport(0, 0, canvas.width, canvas.height);

	glcanvas = canvas;

	// Request texture resources
	var backgroundImage = "/imgs/bstorm_background.png";
	var wheelMaskImage = "/imgs/bstorm_wheelmask.png";


	textures = twgl.createTextures( gl,
	{
		// background : { src: "s/bstorm_background.png", min: gl.LINEAR_MIPMAP_LINEAR, },
		// words :  { src:wordCanvas, min: gl.LINEAR_MIPMAP_LINEAR },
		// wheelmask :  { src:"s/bstorm_wheelmask.png", min: gl.LINEAR_MIPMAP_LINEAR },

		background : { src: backgroundImage,
						crossOrigin: "",
						min: gl.LINEAR_MIPMAP_LINEAR, },

		// words :  { src:wordCanvas, min: gl.LINEAR_MIPMAP_LINEAR },
		wheelmask :  { src: wheelMaskImage,
			min: gl.LINEAR_MIPMAP_LINEAR,
			premultiplyAlpha: 1,
			crossOrigin: "" },

	})

}