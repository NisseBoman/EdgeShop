//! Default Compute@Edge template program.
/// <reference types="@fastly/js-compute" />

// Import only what's needed
import { includeBytes } from "fastly:experimental";
import { KVStore } from "fastly:kv-store";

// Load static files once at compile time
const PAGES = {
  product: includeBytes("./src/product.html"),
  index: includeBytes("./src/index.html"),
  allProducts: includeBytes("./src/products.html"),
  about: includeBytes("./src/about.html"),
  cart: includeBytes("./src/cart.html")
};

// Cache common headers
const COMMON_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=432000"
};

const IMAGE_HEADERS = ext => ({
  "Content-Type": `image/${ext}`,
  "Cache-Control": "public, max-age=432000"
});

// Create response helper
const createResponse = (body, status = 200, headers = COMMON_HEADERS) => {
  return new Response(body, {
    status,
    headers: new Headers(headers)
  });
};

// Helper function to parse cart cookie
function parseCart(cookie) {
  try {
    return cookie ? JSON.parse(decodeURIComponent(cookie)) : {};
  } catch (e) {
    return {};
  }
}

// Helper function to calculate cart totals
function calculateTotals(cart, products) {
  const subtotal = Object.entries(cart).reduce((sum, [id, qty]) => {
    const product = products.Products.find(p => p.ProductId === parseInt(id));
    return sum + (product ? product.ProductPrice * qty : 0);
  }, 0);
  
  const vat = subtotal * 0.25;
  const shipping = 10;
  const total = subtotal + vat + shipping;
  
  return {
    subtotal: subtotal.toFixed(2),
    vat: vat.toFixed(2),
    total: total.toFixed(2)
  };
}

// Create a template cache helper
const replaceTemplateVars = (content, replacements) => {
  return Object.entries(replacements).reduce((acc, [key, value]) => 
    acc.replace(new RegExp(key, 'g'), value), content);
};

// Move cart cookie handling to a separate function
const handleCartCookie = (cart) => {
  return {
    'Location': '/cart',
    'Set-Cookie': `cart=${encodeURIComponent(JSON.stringify(cart))}; Max-Age=600; Path=/`
  };
};

// Consolidate common cart response logic
const createCartResponse = (headers) => {
  return new Response('', {
    status: 302,
    headers: new Headers(headers)
  });
};

// Create a route handler map and handler functions
async function handleHome(store) {
  try {
    const items = await store.get('Items');
    if (!items) throw new NotFoundError("Products not found");
    
    const products = await items.json();
    let content = new TextDecoder().decode(PAGES.index);
    
    // Replace template variables for each product
    const replacements = {};
    products.Products.forEach((product, index) => {
      replacements[`{${index + 1}_Name}`] = product.ProductName;
      replacements[`{${index + 1}_product_id}`] = product.ProductId;
      replacements[`{${index + 1}_image_path}`] = product.ProductImage;
      replacements[`{${index + 1}_product_desc}`] = product.ProductDesc;
    });
    
    return createResponse(replaceTemplateVars(content, replacements));
  } catch (err) {
    return handleError(err);
  }
}

async function handleProducts(store) {
  try {
    const items = await store.get('Items');
    if (!items) throw new NotFoundError("Products not found");
    
    const products = await items.json();
    let content = new TextDecoder().decode(PAGES.allProducts);
    
    const productListHtml = products.Products.map(product => `
      <div class="col-md-4 mb-4">
        <div class="card">
          <img src="/images/${product.ProductImage}" class="card-img-top" alt="${product.ProductName}">
          <div class="card-body">
            <h5 class="card-title">${product.ProductName}</h5>
            <p class="card-text">${product.ProductDesc}</p>
            <p class="card-text"><strong>Price: $${product.ProductPrice.toFixed(2)}</strong></p>
            <a href="/product/${product.ProductId}/" class="btn btn-primary">View Details</a>
          </div>
        </div>
      </div>
    `).join('');
    
    content = content.replace('{all_json}', productListHtml);
    return createResponse(content);
  } catch (err) {
    return handleError(err);
  }
}

async function handleAbout() {
  try {
    let content = new TextDecoder().decode(PAGES.about);
    return createResponse(content);
  } catch (err) {
    return handleError(err);
  }
}

async function handleCart(store, req) {
  try {
    const cartCookie = req.headers.get('cookie')?.match(/cart=([^;]+)/)?.[1] || '';
    let cart = parseCart(cartCookie);
    
    const items = await store.get('Items');
    if (!items) throw new NotFoundError("Products not found");
    
    const products = await items.json();
    let content = new TextDecoder().decode(PAGES.cart);
    
    const cartItemsHtml = Object.entries(cart)
      .map(([id, qty]) => {
        const product = products.Products.find(p => p.ProductId === parseInt(id));
        if (!product) return '';
        
        return createCartItemHtml(product, qty);
      })
      .filter(Boolean)
      .join('');
    
    const totals = calculateTotals(cart, products);
    
    content = replaceTemplateVars(content, {
      '{CART_ITEMS}': cartItemsHtml || '<p>Your cart is empty</p>',
      '{SUBTOTAL}': totals.subtotal,
      '{VAT}': totals.vat,
      '{TOTAL}': totals.total
    });
    
    return new Response(content, {
      status: 200,
      headers: new Headers({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      })
    });
  } catch (err) {
    return handleError(err);
  }
}

const routeHandlers = {
  '/': handleHome,
  '/products': handleProducts,
  '/about': handleAbout,
  '/cart': handleCart
};

// Create custom error classes
class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.status = 404;
  }
}

// Create error handler
const handleError = (err) => {
  console.error(err);
  if (err instanceof NotFoundError) {
    return createResponse(err.message, err.status);
  }
  return createResponse("Internal server error", 500);
};

// Move cart item template to a separate function
const createCartItemHtml = (product, qty) => `
  <div class="card mb-3">
    <div class="card-body">
      <div class="row">
        <div class="col-md-2">
          <img src="/images/${product.ProductImage}" class="img-fluid rounded" alt="${product.ProductName}">
        </div>
        <div class="col-md-5">
          <h5>${product.ProductName}</h5>
        </div>
        <div class="col-md-5">
          <div class="d-flex justify-content-between align-items-center">
            <form method="POST" action="/cart/update/${product.ProductId}" 
              class="d-flex align-items-center" onsubmit="return false;">
              <label class="me-2">Qty:</label>
              <input type="number" name="quantity" value="${qty}" min="0" max="99" 
                class="form-control form-control-sm" style="width: 70px;"
                onchange="this.form.submit()">
            </form>
            <span>$${(product.ProductPrice * qty).toFixed(2)}</span>
            <form method="POST" action="/cart/update/${product.ProductId}" 
              class="ms-3" onsubmit="return confirm('Remove this item from cart?');">
              <input type="hidden" name="quantity" value="0">
              <button type="submit" class="btn btn-link text-danger p-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
                  <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                  <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const CACHE_HEADERS = {
  public: { "Cache-Control": "public, max-age=432000" },
  private: { "Cache-Control": "private, no-cache" },
  none: {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
  }
};

addEventListener("fetch", event => event.respondWith(handleRequest(event)));

async function handleRequest(event) {
  const req = event.request;
  
  if (!["HEAD", "GET", "PURGE", "POST"].includes(req.method)) {
    return createResponse("Method not allowed", 405);
  }

  const url = new URL(req.url);
  const store = new KVStore("EdgeStoreItems");

  // Check for direct route match first
  const handler = routeHandlers[url.pathname];
  if (handler) {
    try {
      return await handler(store, req);
    } catch (err) {
      return handleError(err);
    }
  }

  // Then check pattern matches
  if (url.pathname.startsWith('/cart')) {
    const cartCookie = req.headers.get('cookie')?.match(/cart=([^;]+)/)?.[1] || '';
    let cart = parseCart(cartCookie);
    
    // Handle adding to cart
    const addMatch = url.pathname.match(/^\/cart\/add\/(\d+)/);
    if (addMatch && req.method === 'POST') {
      const productId = addMatch[1];
      const text = await req.text();
      const params = new URLSearchParams(text);
      const quantity = parseInt(params.get('quantity')) || 1;
      
      cart[productId] = (cart[productId] || 0) + quantity;
      
      return createCartResponse(handleCartCookie(cart));
    }
    
    // Handle updating cart quantities
    const updateMatch = url.pathname.match(/^\/cart\/update\/(\d+)/);
    if (updateMatch && req.method === 'POST') {
      const productId = updateMatch[1];
      const text = await req.text();
      const params = new URLSearchParams(text);
      const quantity = parseInt(params.get('quantity')) || 0;
      
      if (quantity > 0) {
        cart[productId] = quantity;
      } else {
        delete cart[productId];
      }
      
      return createCartResponse(handleCartCookie(cart));
    }
  }

  if (url.pathname.startsWith('/product/')) {
    try {
      const productMatch = url.pathname.match(/^\/product\/(\d+)\/?$/);
      if (productMatch) {
        const productId = parseInt(productMatch[1]);
        const items = await store.get('Items');
        
        if (!items) {
          return createResponse("Products not found", 404);
        }

        const products = await items.json();
        const product = products.Products.find(p => p.ProductId === productId);
        
        if (!product) {
          return createResponse("Product not found", 404);
        }

        let content = new TextDecoder().decode(PAGES.product);
        
        // Replace product template variables
        const replacements = {
          "{Product_Title}": product.ProductName,
          "{Product_image_path}": product.ProductImage,
          "{Product_Description}": product.ProductDesc,
          "{Product_Price}": product.ProductPrice.toFixed(2),
          "{Product_Id}": product.ProductId,
          "{JSON}": JSON.stringify(product)
        };

        content = replaceTemplateVars(content, replacements);
        return createResponse(content);

      }
    } catch (err) {
      console.error("Error processing product view:", err);
      return createResponse("Error processing product request", 500);
    }
  }

  // Handle image requests
  if (url.pathname.startsWith("/images/")) {
    const filename = url.pathname.replace(/^.*(\\|\/|\:)/, '');
    const ext = filename.split('.').pop();
    
    try {
      const item = await store.get(filename);
      if (!item) {
        return createResponse("Image not found", 404);
      }
      return createResponse(
        await item.body,
        200,
        IMAGE_HEADERS(ext)
      );
    } catch (err) {
      console.error(`Error fetching image ${filename}:`, err);
      return createResponse("Error processing image", 500);
    }
  }

  // Default 404 response
  return createResponse("Page not found", 404);
}
