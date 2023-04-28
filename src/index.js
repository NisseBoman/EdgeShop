//! Default Compute@Edge template program.
/// <reference types="@fastly/js-compute" />

// import { CacheOverride } from "fastly:cache-override";
// import { Logger } from "fastly:logger";
import { includeBytes } from "fastly:experimental";
//import { get } from "http";
import { CacheOverride } from "fastly:cache-override";

// Load a static file as a Uint8Array at compile time.
// File path is relative to root of project, not to this file
let IndexPage = includeBytes("./src/index.html");



const myHeaders = new Headers();
myHeaders.append('CLIENT_SECRET', '241D9EF8EEDFEC7B2D8E213C9DE61');
myHeaders.append('ACCESS_TOKEN', '13C13122AE89B7E67C7A17DBF6FCA');
myHeaders.append('content-type', 'application/json; charset=utf-8');
myHeaders.append('user-agent', 'curl/7.21.0 (x86_64-pc-linux-gnu) libcurl/7.22.0 OpenSSL/1.0.1 zlib/1.2.3.4 libidn/1.23 librtmp/2.3');
//myHeaders.append('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36');


// The entry point for your application.
//
// Use this fetch event listener to define your main request handling logic. It could be
// used to route based on the request properties (such as method or path), send
// the request to a backend, make completely new requests, and/or generate
// synthetic responses.

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

async function handleRequest(event) {
  
  // Get the client request.
  let req = event.request;

  // Filter requests that have unexpected methods.
  if (!["HEAD", "GET", "PURGE"].includes(req.method)) {
    return new Response("This method is not allowed", {
      status: 405,
    });
  }

  let url = new URL(req.url);

  // If request is to the `/` path...
  if (url.pathname == "/") {
       

    let cacheOverride = new CacheOverride('override', {ttl: 120});

    const response = await fetch('https://api.vin-spritlagret.se/product/618/', {
      backend: "Host_1",
      headers: myHeaders,
      method: "GET",
      cacheOverride
    });
    let product1 = await response.json(); 

    const response2 = await fetch('https://api.vin-spritlagret.se/product/614/', {
      backend: "Host_1",
      headers: myHeaders,
      method: "GET",
      cacheOverride
    });
    let product2 = await response2.json(); 

    const response3 = await fetch('https://api.vin-spritlagret.se/product/617/', {
      backend: "Host_1",
      headers: myHeaders,
      method: "GET",
      cacheOverride
    });
    let product3 = await response3.json(); 

    
    
    //console.log(body.Products.title);

    
    /*
    for (var i=0; i < Object.keys (body.Products).length; i++) {
      console.log(body[i]);

    }
    for (var prod of body.Products)
    {
      console.log(prod.product_title);
    }
    */
  
    
    var tmpstring = new TextDecoder().decode(IndexPage);

    tmpstring = tmpstring.replace("{1_Name}", product1.Products.title);
    tmpstring = tmpstring.replace("{1_image_path}",product1.Products.image);

    tmpstring = tmpstring.replace("{2_Name}", product2.Products.title);
    tmpstring = tmpstring.replace("{2_image_path}",product2.Products.image);

    tmpstring = tmpstring.replace("{3_Name}", product3.Products.title);
    tmpstring = tmpstring.replace("{3_image_path}",product3.Products.image);

    tmpstring = tmpstring.replace("{JSON}",JSON.stringify(product1));
    

    
    // Send a default synthetic response.
    return new Response(tmpstring, {
      status: 200,
      headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
    });
  }

  // Catch all other requests and return a 404.
  return new Response("The page you requested could not be found", {
    status: 404,
  });
}
