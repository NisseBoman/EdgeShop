# EdgeShop demo / playground

[![Deploy to Fastly](https://deploy.edgecompute.app/button)](https://deploy.edgecompute.app/deploy)

This is a demo created that uses an older API created by me and with a webfront using Fastly Comnpute @ Edge. 


**For more details about other starter kits for Compute@Edge, see the [Fastly developer hub](https://developer.fastly.com/solutions/starters)**

## Features

* Get products for start page
* Match request URL path and methods for routing
* Build synthetic responses at the edge

## Planned features (TODO)
* Sort products
* Search products


## Key Features Implementation

### Performance
* 100% of the requests are served from the edge
* Dynamic compression
* Using KV Store
* Using Fastly Cache

### Cart Management
- Uses browser cookies to maintain cart state
- 10-minute session timeout
- Real-time price calculations including VAT (25%) and shipping ($10)

### Image Handling
- Serves product images from KV Store
- Implements proper caching headers
- Supports multiple image formats

### Error Handling
- Graceful error handling for missing products/images
- User-friendly error messages
- Proper HTTP status codes

## Testing

To test the application locally:

1. Start the development server: