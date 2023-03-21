//! Default Compute@Edge template program.

/// <reference types="@fastly/js-compute" />
import indexPage from "./index.html";

const myHeaders = new Headers();
myHeaders.append('CLIENT_SECRET', '241D9EF8EEDFEC7B2D8E213C9DE61');
myHeaders.append('ACCESS_TOKEN', '13C13122AE89B7E67C7A17DBF6FCA');

let jsonData;

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
  if (!["HEAD", "GET"].includes(req.method)) {
    return new Response("This method is not allowed", {
      status: 405,
    });
  }

  let url = new URL(req.url);



  // If request is to the `/` path...
  if (url.pathname == "/") {
    // Below are some common patterns for Compute@Edge services using JavaScript.
    // Head to https://developer.fastly.com/learning/compute/javascript/ to discover more.

    // Create a new request.
    //let bereq = new Request("http://api.vin-spritlagret.se/product/618/");

    async function handler(event) {
      let backendResponse = await fetch("http://api.vin-spritlagret.se/product/618/", {
        method: "GET",
        backend: "srv02.vin-spritlagret.se",
        headers: myHeaders,

    });
    jsonData = await backendResponse.json();
}

    // Add request headers.
    //req.headers.set("CLIENT_SECRET", "241D9EF8EEDFEC7B2D8E213C9DE61");
    // req.headers.set(
    //   "ACCESS_TOKEN",
    //   "13C13122AE89B7E67C7A17DBF6FCA"
    // );

    // Create a cache override.
    // let cacheOverride = new CacheOverride("override", { ttl: 60 });

    // Forward the request to a backend.
    // let beresp = await fetch(req, {
    //   backend: "backend_name",
    //   cacheOverride,
    // });

    // Remove response headers.
    // beresp.headers.delete("X-Another-Custom-Header");

    // Log to a Fastly endpoint.
    // const logger = fastly.getLogger("my_endpoint");
    // logger.log("Hello from the edge!");

    indexPage = indexPage.replace("{1_Name}", "Rut & Jollan är bäst!");
    indexPage = indexPage.replace("{JSON}", JSON.stringify(jsonData, undefined, 2));
    // Send a default synthetic response.
    return new Response(indexPage, {
      status: 200,
      headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
    });
  }

  // Catch all other requests and return a 404.
  return new Response("The page you requested could not be found", {
    status: 404,
  });
}
