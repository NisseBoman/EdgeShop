//! Default Compute@Edge template program.
/// <reference types="@fastly/js-compute" />

// import { CacheOverride } from "fastly:cache-override";
// import { Logger } from "fastly:logger";
import { includeBytes } from "fastly:experimental";
import { get } from "http";

// Load a static file as a Uint8Array at compile time.
// File path is relative to root of project, not to this file
let IndexPage = includeBytes("./src/index.html");



const myHeaders = new Headers();
myHeaders.append('CLIENT_SECRET', '241D9EF8EEDFEC7B2D8E213C9DE61');
myHeaders.append('ACCESS_TOKEN', '13C13122AE89B7E67C7A17DBF6FCA');

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
       

    const response = await fetch('http://api.vin-spritlagret.se/product/618/', {
      backend: "Host_1",
      headers: myHeaders,
      method: "GET",
    });
    const body = await response.text();
    console.log(body);
    const IndexPage = IndexPage.replace("{JSON}",body.text);

    
    // Send a default synthetic response.
    return new Response(IndexPage, {
      status: 200,
      headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
    });
  }

  // Catch all other requests and return a 404.
  return new Response("The page you requested could not be found", {
    status: 404,
  });
}
