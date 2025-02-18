import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import Frame from 'react-frame-component';

const RectangleEditor = () => {
  const [selectedId, setSelectedId] = useState(null);
  const [action, setAction] = useState(null);
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
  const [rect, setrect] = useState(null);
  const [lastAngle, setLastAngle] = useState(0);
  const [hoveredCorner, setHoveredCorner] = useState({ id: null, corner: null });
  const [selectionOrder, setSelectionOrder] = useState([]);

  const [activeTouches, setActiveTouches] = useState(new Map());
  const [initialTouchDistance, setInitialTouchDistance] = useState(null);
  const [initialTouchAngle, setInitialTouchAngle] = useState(null);
  const [initialScale, setInitialScale] = useState(1);
  const [initialRotation, setInitialRotation] = useState(0);
  
  const canvasRef = useRef(null);
  const scrollPositions = useRef({});


  // New viewport state
  const [viewport, setViewport] = useState({
    x: 0,
    y: 0,
    scale: 1
  });

  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const [canvasRotation, setCanvasRotation] = useState(0);
  const [isRotatingCanvas, setIsRotatingCanvas] = useState(false);
  const rotationStartPoint = useRef({ x: 0, y: 0 });
  

  // Initialize with a centered rectangle
  let initialWidth = window.innerWidth - (2 * 0.2 * window.innerWidth);
  let initialHeight = window.innerHeight - (2 * 0.2 * window.innerHeight);

  let message = "#\n\n **Paper Controls:** \n\n Hover around the **corners** to edit the current page \n\n Outside a corner to **rotate** \n\n On a corner to **scale** \n\n Inside a corner to **drag**\n\n **Canvas Controls** \n\n Left click and drag to **pan** \n\n Right click and drag to **rotate** \n\n Scroll to **zoom** [**Click Here For New Page**](function:addRectangle)\n\n [Wikipedia](https://en.wikipedia.org/wiki/Bernoulli_distribution)"

  const initialRect = {
    id: Date.now(), 
    x: (window.outerWidth - initialWidth)/2,
    y: (window.innerHeight - initialHeight)/2,  
    width: initialWidth, 
    height: initialHeight,
    rotation: 0,
    color: `hsl(192, 100.00%, 99.00%)`,
    text: message
  };

  const [rectangles, setRectangles] = useState([initialRect]);
    
  const addRectangle = () => {
    const newRect = {
      id: Date.now(),
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      width: 300,
      height: 200,
      rotation: Math.random() * 360,
      color: `hsl(192, 100.00%, 99.00%)`,
      text: message
    };
    setRectangles(prev => [...prev, newRect]);
    setSelectedId(newRect.id);
    // Add new rectangle to the top of the selection order
    setSelectionOrder(prev => [newRect.id, ...prev]);
  };

  // Initialize selection order with the initial rectangle
  useEffect(() => {
    setSelectionOrder([initialRect.id]);
  }, []);

  // Custom cursors
  const cursors = {
    rotate: `url("data:image/svg+xml;base64,${btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2">
        <path d="M21 12a9 9 0 11-3-6.7"/>
        <path d="M22 4V10H16"/>
      </svg>
    `)}") 12 12, crosshair`,
    
    scale: `url("data:image/svg+xml;base64,${btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2">
        <path d="M12 12 L20 4" stroke-linecap="round"/>
        <path d="M20 4 L16 4" stroke-linecap="round"/>
        <path d="M20 4 L20 8" stroke-linecap="round"/>
        <path d="M12 12 L4 20" stroke-linecap="round"/>
        <path d="M4 20 L8 20" stroke-linecap="round"/>
        <path d="M4 20 L4 16" stroke-linecap="round"/>
      </svg>
    `)}") 12 12, nw-resize`
  };

const handleMouseEnter = useCallback((e, rectId) => {
  e.stopPropagation();
  if (selectedId !== rectId) {
    setSelectedId(rectId);
    // Update selection order by moving the selected rectangle to the front
    setSelectionOrder(prev => {
      const filtered = prev.filter(id => id !== rectId);
      return [rectId, ...filtered];
    });
  }
}, [selectedId]);

  const getZIndex = (rectId) => {
    // Check if this is the most recently created rectangle
    if (rectId === Math.max(...rectangles.map(r => r.id))) {
      // Give it the highest possible z-index
      return selectionOrder.length + 1;
    }
    // Otherwise use selection order for z-index
    const index = selectionOrder.indexOf(rectId);
    return selectionOrder.length - index;
  };

  const handleMouseLeave = useCallback((e, rectId) => {
    e.stopPropagation();
    
    // Use requestAnimationFrame to handle asynchronous mouse movement more reliably
    requestAnimationFrame(() => {
        // Get the element under the current mouse cursor
        const underCursor = document.elementFromPoint(
            e.clientX, 
            e.clientY
        );
        
        // Check if the element under the cursor is NOT inside the current rectangle
        if (!underCursor || 
            !underCursor.closest(`[data-rect-id="${rectId}"]`)) {
            setSelectedId(null);
        }
    });
}, []);

const isPointNearCorner = (mouseX, mouseY, rect, canvasRotation, viewport) => {
  const threshold = 80;
  
  // Get canvas center (origin of rotation)
  const canvasCenter = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2
  };
  
  // Step 1: Normalize canvas parameters
  const canvasRotationRad = (-canvasRotation * Math.PI) / 180;
  const scale = viewport.scale;
  
  // Step 2: Transform mouse coordinates to normalized world space
  // First, translate relative to canvas center
  const relativeToCenterX = mouseX - canvasCenter.x;
  const relativeToCenterY = mouseY - canvasCenter.y;
  
  // Apply inverse canvas rotation
  const unrotatedX = (
    relativeToCenterX * Math.cos(canvasRotationRad) - 
    relativeToCenterY * Math.sin(canvasRotationRad)
  );
  const unrotatedY = (
    relativeToCenterX * Math.sin(canvasRotationRad) + 
    relativeToCenterY * Math.cos(canvasRotationRad)
  );
  
  // Apply inverse viewport scaling and translation
  const worldMouseX = (unrotatedX / scale) - (viewport.x / scale) + canvasCenter.x;
  const worldMouseY = (unrotatedY / scale) - (viewport.y / scale) + canvasCenter.y;
  
  // Get the center of the rectangle (the point of rotation)
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  
  // Convert rectangle rotation to radians
  const rectAngleRad = (rect.rotation * Math.PI) / 180;
  const cos = Math.cos(-rectAngleRad);
  const sin = Math.sin(-rectAngleRad);
  
  // Translate mouse point relative to rectangle's center
  const relativeX = worldMouseX - centerX;
  const relativeY = worldMouseY - centerY;
  
  // Rotate the mouse coordinates to align with rectangle's coordinate system
  const rotatedMouseX = (relativeX * cos - relativeY * sin) + centerX;
  const rotatedMouseY = (relativeX * sin + relativeY * cos) + centerY;
  
  // Get corner coordinates in the original, unrotated space
  const corners = {
    topleft: { x: rect.x, y: rect.y },
    topright: { x: rect.x + rect.width, y: rect.y },
    bottomleft: { x: rect.x, y: rect.y + rect.height },
    bottomright: { x: rect.x + rect.width, y: rect.y + rect.height }
  };
  
  // Calculate distances to each corner
  const cornerDistances = Object.entries(corners).map(([corner, { x, y }]) => {
    const dx = rotatedMouseX - x;
    const dy = rotatedMouseY - y;
    return {
      corner,
      distance: Math.sqrt(dx * dx + dy * dy)
    };
  });
  
  // Find the closest corner within the threshold
  const closestCorner = cornerDistances.reduce((closest, current) => 
    current.distance < closest.distance ? current : closest
  );
  
  return closestCorner.distance < threshold 
    ? { 
        isNear: true, 
        corner: closestCorner.corner 
      } 
    : { 
        isNear: false, 
        corner: null 
      };
};

const handleMouseMove = useCallback((e) => {
  if (!canvasRef.current) return;
  
  const canvas = canvasRef.current.getBoundingClientRect();
  const mouseX = e.clientX - canvas.left;
  const mouseY = e.clientY - canvas.top;

  // Find the rectangle under the cursor
  const hoveredRect = rectangles.find(rect => {
    // Convert to world coordinates
    const worldMouseX = (mouseX - viewport.x) / viewport.scale;
    const worldMouseY = (mouseY - viewport.y) / viewport.scale;

    // Calculate rectangle bounds
    const rectLeft = rect.x;
    const rectTop = rect.y;
    const rectRight = rect.x + rect.width;
    const rectBottom = rect.y + rect.height;

    // Check if point is within rectangle bounds
    return (
      worldMouseX >= rectLeft &&
      worldMouseX <= rectRight &&
      worldMouseY >= rectTop &&
      worldMouseY <= rectBottom
    );
  });

  // Update selection based on hovered rectangle
  if (hoveredRect) {
    if (selectedId !== hoveredRect.id) {
      setSelectedId(hoveredRect.id);
      // Update selection order by moving the selected rectangle to the front
      setSelectionOrder(prev => {
        const filtered = prev.filter(id => id !== hoveredRect.id);
        return [hoveredRect.id, ...filtered];
      });
    }
  } else {
    // Clear selection if no rectangle is under the cursor
    setSelectedId(null);
  }

  // Check for corner hover on the selected rectangle
  let foundHover = false;
  for (const rect of rectangles) {
    if (rect.id === selectedId) {
      const cornerResult = isPointNearCorner(
        mouseX, 
        mouseY, 
        rect, 
        canvasRotation, 
        viewport
      );

      if (cornerResult.isNear) {
        setHoveredCorner({ 
          id: rect.id, 
          corner: cornerResult.corner 
        });
        foundHover = true;
        break;
      }
    }
  }

  if (!foundHover) {
    setHoveredCorner({ id: null, corner: null });
  }
}, [rectangles, selectedId, canvasRotation, viewport]);


  const InteractiveArea = ({ x, y, size = 40, cursor, onMouseDown, onMouseEnter, onMouseLeave }) => (
    <div
      className="absolute"
      style={{
        transform: 'translate(-50%, -50%)',
        left: `${x}px`,
        top: `${y}px`,
        width: `${size}px`,
        height: `${size}px`,
        cursor,
        zIndex: 30
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e);
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );


  const RectangleContent = React.memo(({ rect, scrollPositions }) => {
    const contentRef = useRef(null);
  
    const handleScroll = useCallback((e) => {
      scrollPositions.current[rect.id] = e.target.scrollTop;
    }, [rect.id, scrollPositions]);
  
    useLayoutEffect(() => {
      const element = contentRef.current;
      if (element) {
        const savedPosition = scrollPositions.current[rect.id];
        if (savedPosition !== undefined) {
          element.scrollTop = savedPosition;
        }
      }
    }, [rect.id]);
  
    const renderContent = useCallback((text) => {
      // Check if the text contains an iframe
      const iframeMatch = text.match(/<iframe.*?src="(.*?)".*?>/);
      
      if (iframeMatch) {
        // If an iframe is present, render it directly with a sandbox attribute
        return (
          <div className="absolute inset-0 flex flex-col">
            <div className="p-2 bg-gray-100 flex items-center justify-between">
              <div 
                className="cursor-pointer text-blue-600 hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  addRectangle();
                }}
              >
              </div>
            </div>
            <iframe 
              src={iframeMatch[1]} 
              className="flex-grow border-none" 
              style={{ width: '100%', height: 'calc(100% - 40px)' }}
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        );
      }
  
      // Existing rendering logic for normal text
      const parts = text.match(/(\[.*?\]\((?:function:addRectangle|https?:\/\/[^\)]+)\))|([^\[]+)/g) || [];
      
      return parts.map((part, index) => {
        // Check for function call link (add rectangle)
        if (part.match(/\[.*?\]\(function:addRectangle\)/)) {
          const linkText = part.match(/\[(.*?)\]/)[1];
          return (
            <div 
              key={index} 
              className="inline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                addRectangle();
              }}
            >
              <div style={{ fontFamily: 'Helvetica', fontSize: '16px' }}>
                <ReactMarkdown className="cursor-pointer">
                  {linkText}
                </ReactMarkdown>
              </div>
            </div>
          );
        }
        
        // Check for external link
        const externalLinkMatch = part.match(/\[(.*?)\]\((https?:\/\/[^\)]+)\)/);
        if (externalLinkMatch) {
          const [, linkText, url] = externalLinkMatch;
          return (
            <div 
              key={index} 
              className="inline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Create a new rectangle with the loaded URL
                const newRect = {
                  id: Date.now(),
                  x: Math.random() * window.innerWidth,
                  y: Math.random() * window.innerHeight,
                  width: 800,
                  height: 600,
                  rotation: Math.random() * 360,
                  color: `hsl(192, 100.00%, 99.00%)`,
                  text: `<iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>`
                };
                
                setRectangles(prev => [...prev, newRect]);
                setSelectedId(newRect.id);
                setSelectionOrder(prev => [newRect.id, ...prev]);
              }}
            >
              <div style={{ fontFamily: 'Helvetica', fontSize: '16px' }}>
                <ReactMarkdown className="cursor-pointer text-blue-600 hover:underline">
                  {linkText}
                </ReactMarkdown>
              </div>
            </div>
          );
        }
        
        // Regular text
        return (
          <div key={index} style={{ fontFamily: 'Helvetica', fontSize: '16px' }}>
            <ReactMarkdown>{part}</ReactMarkdown>
          </div>
        );
      });
    }, [addRectangle, setRectangles, setSelectedId, setSelectionOrder]);
  
    return (
      <div 
        ref={contentRef}
        className="absolute inset-0 p-4 overflow-auto select-text"
        onClick={(e) => e.stopPropagation()}
        onScroll={handleScroll}
        style={{ cursor: 'text' }}
      >
        <div className="prose prose-sm max-w-none h-full">
          {renderContent(rect.text)}
        </div>
      </div>
    );
  });

const getCenter = (rect) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2
});

const getAngle = (center, point) => {
  return Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;
};

const getTouchDistance = (touch1, touch2) => {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

// Function to calculate angle between two touch points
const getTouchAngle = (touch1, touch2) => {
  return Math.atan2(
    touch2.clientY - touch1.clientY,
    touch2.clientX - touch1.clientX
  ) * 180 / Math.PI;
};
  
const handleTouchStart = useCallback((e) => {
  e.preventDefault();
  const touches = Array.from(e.touches);
  
  // Update active touches
  const newTouches = new Map();
  touches.forEach(touch => {
    newTouches.set(touch.identifier, {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
  });
  setActiveTouches(newTouches);

  if (touches.length === 2) {
    // Initialize pinch-zoom and rotation
    const distance = getTouchDistance(touches[0], touches[1]);
    const angle = getTouchAngle(touches[0], touches[1]);
    setInitialTouchDistance(distance);
    setInitialTouchAngle(angle);
    setInitialScale(viewport.scale);
    setInitialRotation(canvasRotation);
  } else if (touches.length === 1) {
    // Handle single touch for dragging
    const touch = touches[0];
    lastMousePos.current = { x: touch.clientX, y: touch.clientY };
    setIsDraggingCanvas(true);
  }
}, [viewport.scale, canvasRotation]);

const handleTouchMove = useCallback((e) => {
  e.preventDefault();
  const touches = Array.from(e.touches);

  if (touches.length === 2) {
    // Handle pinch-zoom and rotation
    const currentDistance = getTouchDistance(touches[0], touches[1]);
    const currentAngle = getTouchAngle(touches[0], touches[1]);

    if (initialTouchDistance && initialTouchAngle) {
      // Calculate new scale
      const scaleFactor = currentDistance / initialTouchDistance;
      const newScale = Math.min(Math.max(initialScale * scaleFactor, 0.1), 5);
      
      // Calculate rotation
      const rotationDelta = currentAngle - initialTouchAngle;
      const newRotation = (initialRotation + rotationDelta) % 360;

      setViewport(prev => ({
        ...prev,
        scale: newScale
      }));
      setCanvasRotation(newRotation);
    }
  } else if (touches.length === 1 && isDraggingCanvas) {
    // Handle single touch drag
    const touch = touches[0];
    const dx = touch.clientX - lastMousePos.current.x;
    const dy = touch.clientY - lastMousePos.current.y;
    
    setViewport(prev => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy
    }));
    
    lastMousePos.current = { x: touch.clientX, y: touch.clientY };
  }
}, [initialTouchDistance, initialTouchAngle, initialScale, initialRotation, isDraggingCanvas]);

const handleTouchEnd = useCallback((e) => {
  if (e.touches.length === 0) {
    // Reset all touch states when all fingers are lifted
    setInitialTouchDistance(null);
    setInitialTouchAngle(null);
    setActiveTouches(new Map());
    setIsDraggingCanvas(false);
  }
}, []);

// Update the canvas dragging handlers to handle right-click rotation
const handleCanvasMouseDown = useCallback((e) => {
  // Get the mouse position relative to the canvas
  const canvas = canvasRef.current.getBoundingClientRect();
  const mouseX = e.clientX - canvas.left;
  const mouseY = e.clientY - canvas.top;

  // Check if the mouse is over any rectangle's content area
  const isOverRectangle = rectangles.some(rect => {
    // Convert to world coordinates
    const worldMouseX = (mouseX - viewport.x) / viewport.scale;
    const worldMouseY = (mouseY - viewport.y) / viewport.scale;

    // Calculate rectangle bounds including padding
    const padding = 20;
    const rectLeft = rect.x - padding;
    const rectTop = rect.y - padding;
    const rectRight = rect.x + rect.width + padding;
    const rectBottom = rect.y + rect.height + padding;

    // Check if point is within padded rectangle bounds
    return (
      worldMouseX >= rectLeft &&
      worldMouseX <= rectRight &&
      worldMouseY >= rectTop &&
      worldMouseY <= rectBottom
    );
  });

  // Only allow canvas transformations if no rectangle is selected AND we're not over a rectangle
  if (!selectedId && !isOverRectangle) {
    if (e.button === 0) { // Left click
      setIsDraggingCanvas(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    } else if (e.button === 2) { // Right click
      e.preventDefault();
      setIsRotatingCanvas(true);
      rotationStartPoint.current = { x: e.clientX, y: e.clientY };
    }
  }
}, [rectangles, viewport, selectedId]);


const handleCanvasMouseMove = useCallback((e) => {
  if (isDraggingCanvas) {
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    
    setViewport(prev => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy
    }));
    
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  } else if (isRotatingCanvas) {
    // Calculate the center of the viewport
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    
    // Calculate angles from center to start and current points
    const startAngle = Math.atan2(
      rotationStartPoint.current.y - centerY,
      rotationStartPoint.current.x - centerX
    );
    const currentAngle = Math.atan2(
      e.clientY - centerY,
      e.clientX - centerX
    );
    
    // Calculate rotation delta in degrees
    const deltaRotation = (currentAngle - startAngle) * (180 / Math.PI);
    
    setCanvasRotation(prev => prev + deltaRotation);
    rotationStartPoint.current = { x: e.clientX, y: e.clientY };
  }
}, [isDraggingCanvas, isRotatingCanvas]);

const handleCanvasMouseUp = useCallback(() => {
  setIsDraggingCanvas(false);
  setIsRotatingCanvas(false);
}, []);

const handleContextMenu = useCallback((e) => {
  e.preventDefault();
}, []);

// Handle wheel - updated to allow text scrolling in rectangles
const handleWheel = useCallback((e) => {
  if (!canvasRef.current) return;
  
  // Get mouse position
  const mouseX = e.clientX;
  const mouseY = e.clientY;

  // Check if the mouse is over any rectangle's content area
  const isOverRectangle = rectangles.some(rect => {
    const worldMouseX = (mouseX - viewport.x) / viewport.scale;
    const worldMouseY = (mouseY - viewport.y) / viewport.scale;

    const rectLeft = rect.x;
    const rectTop = rect.y;
    const rectRight = rect.x + rect.width;
    const rectBottom = rect.y + rect.height;

    return (
      worldMouseX >= rectLeft &&
      worldMouseX <= rectRight &&
      worldMouseY >= rectTop &&
      worldMouseY <= rectBottom
    );
  });

  // Only allow zooming if no rectangle is selected AND we're not over a rectangle
  if (!selectedId && !isOverRectangle) {
    e.preventDefault();
    
    const worldMouseX = (mouseX - viewport.x) / viewport.scale;
    const worldMouseY = (mouseY - viewport.y) / viewport.scale;

    const zoomAmount = -e.deltaY * 0.001;
    const newScale = viewport.scale * Math.exp(zoomAmount);
    const scale = Math.min(Math.max(newScale, 0.1), 5);
    
    setViewport(prev => ({
      scale,
      x: prev.x,
      y: prev.y
    }));
  }
}, [rectangles, viewport, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      // Add touch event listeners
      canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
      canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
      canvas.addEventListener('touchend', handleTouchEnd);
      canvas.addEventListener('touchcancel', handleTouchEnd);

      // Existing mouse event listeners...
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      canvas.addEventListener('mousedown', handleCanvasMouseDown);
      canvas.addEventListener('mousemove', handleCanvasMouseMove);
      canvas.addEventListener('contextmenu', handleContextMenu);
      document.addEventListener('mouseup', handleCanvasMouseUp);
      
      return () => {
        // Remove touch event listeners
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
        canvas.removeEventListener('touchcancel', handleTouchEnd);

        // Remove existing mouse event listeners...
        canvas.removeEventListener('wheel', handleWheel);
        canvas.removeEventListener('mousedown', handleCanvasMouseDown);
        canvas.removeEventListener('mousemove', handleCanvasMouseMove);
        canvas.removeEventListener('contextmenu', handleContextMenu);
        document.removeEventListener('mouseup', handleCanvasMouseUp);
      };
    }
  }, [
    handleWheel,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  ]);

  // Rectangle transformation handlers
  // Rectangle transformation handlers
  const handleMouseDown = (e, id, actionType, corner) => {
    if (!canvasRef.current) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const rect = rectangles.find(r => r.id === id);
    if (!rect) return;
  
    const canvas = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - canvas.left;
    const mouseY = e.clientY - canvas.top;
    
    // Convert screen coordinates to canvas space
    const canvasCenter = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };
  
    // First, transform mouse coordinates relative to canvas center
    const relativeToCenterX = mouseX - canvasCenter.x;
    const relativeToCenterY = mouseY - canvasCenter.y;
    
    // Apply inverse canvas rotation and scale
    const canvasRotationRad = (-canvasRotation * Math.PI) / 180;
    const rotatedX = (
      relativeToCenterX * Math.cos(canvasRotationRad) - 
      relativeToCenterY * Math.sin(canvasRotationRad)
    );
    const rotatedY = (
      relativeToCenterX * Math.sin(canvasRotationRad) + 
      relativeToCenterY * Math.cos(canvasRotationRad)
    );
    
    // Apply inverse viewport transform to get world coordinates
    const worldStartX = (rotatedX / viewport.scale) - (viewport.x / viewport.scale) + canvasCenter.x;
    const worldStartY = (rotatedY / viewport.scale) - (viewport.y / viewport.scale) + canvasCenter.y;
  
    setSelectedId(id);
    setAction({ type: actionType, corner });
    setStartPoint({ x: worldStartX, y: worldStartY });
    setrect({ ...rect });
    setLastAngle(rect.rotation);
  
    const handleMove = (moveEvent) => {
      const currentMouseX = moveEvent.clientX - canvas.left;
      const currentMouseY = moveEvent.clientY - canvas.top;
  
      // Convert current mouse position using same transformation as start point
      const relativeCurrentX = currentMouseX - canvasCenter.x;
      const relativeCurrentY = currentMouseY - canvasCenter.y;
      
      const rotatedCurrentX = (
        relativeCurrentX * Math.cos(canvasRotationRad) - 
        relativeCurrentY * Math.sin(canvasRotationRad)
      );
      const rotatedCurrentY = (
        relativeCurrentX * Math.sin(canvasRotationRad) + 
        relativeCurrentY * Math.cos(canvasRotationRad)
      );
      
      const worldCurrentX = (rotatedCurrentX / viewport.scale) - (viewport.x / viewport.scale) + canvasCenter.x;
      const worldCurrentY = (rotatedCurrentY / viewport.scale) - (viewport.y / viewport.scale) + canvasCenter.y;
      
      // Calculate world space delta
      const deltaX = worldCurrentX - worldStartX;
      const deltaY = worldCurrentY - worldStartY;
  
      setRectangles(prevRects => 
        prevRects.map(r => {
          if (r.id !== id) return r;
  
          if (actionType === 'move') {
            // For move action, we can directly apply the world-space delta
            // since our coordinate transformation already accounts for canvas rotation
            return {
              ...r,
              x: rect.x + deltaX,
              y: rect.y + deltaY
            };
          }
  
          if (actionType === 'rotate') {
            const center = {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2
            };
            
            // Calculate angles in the canvas-rotated coordinate system
            const startAngle = Math.atan2(
              worldStartY - center.y,
              worldStartX - center.x
            );
            const currentAngle = Math.atan2(
              worldCurrentY - center.y,
              worldCurrentX - center.x
            );
            const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);
            
            return {
              ...r,
              rotation: (rect.rotation + deltaAngle) % 360
            };
          }
  
          if (actionType === 'resize') {
            // Get rectangle's center in world space
            const centerX = rect.x + rect.width / 2;
            const centerY = rect.y + rect.height / 2;
  
            // Convert world coordinates to rectangle's local space
            // First, undo the rectangle's rotation
            const rectAngleRad = (rect.rotation * Math.PI) / 180;
            const cos = Math.cos(-rectAngleRad);
            const sin = Math.sin(-rectAngleRad);
  
            // Transform current point to rectangle's local space
            const relativeMouseX = worldCurrentX - centerX;
            const relativeMouseY = worldCurrentY - centerY;
            const rectLocalCurrentX = relativeMouseX * cos - relativeMouseY * sin;
            const rectLocalCurrentY = relativeMouseX * sin + relativeMouseY * cos;
  
            // Transform start point to rectangle's local space
            const relativeStartX = worldStartX - centerX;
            const relativeStartY = worldStartY - centerY;
            const rectLocalStartX = relativeStartX * cos - relativeStartY * sin;
            const rectLocalStartY = relativeStartX * sin + relativeStartY * cos;
  
            // Calculate deltas in rectangle's local space
            const deltaLocalX = rectLocalCurrentX - rectLocalStartX;
            const deltaLocalY = rectLocalCurrentY - rectLocalStartY;
  
            // Initialize new dimensions
            let newWidth = rect.width;
            let newHeight = rect.height;
            let newX = rect.x;
            let newY = rect.y;
            
            // Scale factor to account for canvas rotation and scale
            const scaleFactor = 1;
  
            switch(corner) {
              case 'topleft':
                newWidth = rect.width - deltaLocalX * scaleFactor;
                newHeight = rect.height - deltaLocalY * scaleFactor;
                break;
              case 'topright':
                newWidth = rect.width + deltaLocalX * scaleFactor;
                newHeight = rect.height - deltaLocalY * scaleFactor;
                break;
              case 'bottomleft':
                newWidth = rect.width - deltaLocalX * scaleFactor;
                newHeight = rect.height + deltaLocalY * scaleFactor;
                break;
              case 'bottomright':
                newWidth = rect.width + deltaLocalX * scaleFactor;
                newHeight = rect.height + deltaLocalY * scaleFactor;
                break;
            }
            
            // Calculate the change in dimensions
            const deltaWidth = newWidth - rect.width;
            const deltaHeight = newHeight - rect.height;
  
            // Ensure minimum size
            newWidth = Math.max(50, newWidth);
            newHeight = Math.max(50, newHeight);
  
            // Calculate position adjustments to maintain the correct corner position
            // Convert the dimension changes back to world space
            const worldDeltaX = (deltaWidth / 2) * Math.cos(rectAngleRad) - (deltaHeight / 2) * Math.sin(rectAngleRad);
            const worldDeltaY = (deltaWidth / 2) * Math.sin(rectAngleRad) + (deltaHeight / 2) * Math.cos(rectAngleRad);
  
            // Adjust position to maintain the correct corner
            newX = centerX - newWidth / 2;
            newY = centerY - newHeight / 2;
  
            return {
              ...r,
              width: newWidth,
              height: newHeight,
              x: newX,
              y: newY
            };
          }
  
          return r;
        })
      );
    };
  
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setAction(null);
      setrect(null);
    };
  
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleCornerHover = (e, id, corner) => {
    setHoveredCorner({ id, corner });
    handleMouseEnter(e, id);
  };

  const handleCornerLeave = (e, id) => {
    e.stopPropagation();
    setHoveredCorner({ id: null, corner: null });
    handleMouseLeave(e, id);
  };

  return (
    <div>
<div ref={canvasRef}
  className="fixed inset-0 bg-gray-100"
  style={{ 
    overflow: 'hidden',
    cursor: isDraggingCanvas ? 'grabbing' : isRotatingCanvas ? cursors.rotate : 'grab'
  }}>
  <div
    style={{
      position: 'absolute',
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale}) rotate(${canvasRotation}deg)`,
      transformOrigin: '50% 50%',
      width: '100%',
      height: '100%'
    }}
  >
        {rectangles.map((rect) => {
          const corners = ['topleft', 'topright', 'bottomleft', 'bottomright'];
          const padding = 20;

          return (
            <div 
              key={rect.id} 
              data-rect-id={rect.id} 
              className="absolute"
              style={{
                left: `${rect.x - padding}px`,
                top: `${rect.y - padding}px`,
                width: `${rect.width + 2 * padding}px`,
                height: `${rect.height + 2 * padding}px`,
                transform: `rotate(${rect.rotation}deg)`,
                transformOrigin: `${rect.width/2 + padding}px ${rect.height/2 + padding}px`,
                zIndex: getZIndex(rect.id),
              }}
              onMouseEnter={(e) => handleMouseEnter(e, rect.id)}
              onMouseLeave={(e) => handleMouseLeave(e, rect.id)}
            >
            <div 
                className="absolute inset-0"
                style={{
                    pointerEvents: 'none',
                    cursor: 'default'
                }}
              />
              {/* Shadow and clipping container */}
              <div
                className="absolute"
                style={{
                  left: `${padding}px`,
                  top: `${padding}px`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                  boxShadow: selectedId === rect.id 
                  ? '8px 8px 16px rgba(0, 0, 0, 0.4)' 
                  : '4px 4px 8px rgba(0, 0, 0, 0.2)',
                  /*
                  
                  */
                }}
              >
                {/* Main content with clipping */}
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{
                    backgroundColor: rect.color,
                    cursor: 'default',
                    clipPath: hoveredCorner.id === rect.id ? (() => {
                      const size = 20;
                      const overlap = 10;
                      switch(hoveredCorner.corner) {
                        case 'topleft':
                          return `polygon(${size + overlap}px 0, 100% 0, 100% 100%, 0 100%, 0 ${size + overlap}px)`;
                        case 'topright':
                          return `polygon(0 0, calc(100% - ${size + overlap}px) 0, 100% ${size + overlap}px, 100% 100%, 0 100%)`;
                        case 'bottomleft':
                          return `polygon(0 0, 100% 0, 100% 100%, ${size + overlap}px 100%, 0 calc(100% - ${size + overlap}px))`;
                        case 'bottomright':
                          return `polygon(0 0, 100% 0, 100% calc(100% - ${size + overlap}px), calc(100% - ${size + overlap}px) 100%, 0 100%)`;
                        default:
                          return 'none';
                      }
                    })() : 'none'
                  }}
                ></div>

                {/* Folded corners */}
                {selectedId === rect.id && corners.map(corner => {
                  const isHovered = hoveredCorner.id === rect.id && hoveredCorner.corner === corner;
                  if (!isHovered) return null;
                  
                  const size = 20;
                  let placement = {};
                  let transform = 'rotate(0deg)';
                  
                  switch(corner) {
                    case 'topleft':
                      placement = { top: 0, left: 0 };
                      break;
                    case 'topright':
                      placement = { top: 0, right: 0 };
                      transform = 'rotate(90deg)';
                      break;
                    case 'bottomleft':
                      placement = { bottom: 0, left: 0 };
                      transform = 'rotate(270deg)';
                      break;
                    case 'bottomright':
                      placement = { bottom: 0, right: 0 };
                      transform = 'rotate(180deg)';
                      break;
                  }

                  return (
                    <div
                      key={corner}
                      style={{
                        position: 'absolute',
                        width: `${size}px`,
                        height: `${size}px`,
                        ...placement,
                        pointerEvents: 'none',
                        transition: 'all 0.15s ease-in-out',
                        zIndex: 1
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          width: '100%',
                          height: '100%',
                          background: 'clear',
                          transform,
                          boxShadow: '2px 2px 4px rgba(0, 0, 0, 0.2)',
                          clipPath: 'polygon(0 0, 100% 0, 0 100%)'
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              
              {/* Main rectangle content */}
              <div
                className="absolute overflow-hidden"
                style={{
                  left: `${padding}px`,
                  top: `${padding}px`,
                  width: `${rect.width}px`,
                  height: `${rect.height}px`,
                  backgroundColor: rect.color,
                  cursor: 'default',
                  clipPath: hoveredCorner.id === rect.id ? (() => {
                    const size = 20;
                    const overlap = 10;
                    switch(hoveredCorner.corner) {
                      case 'topleft':
                        return `polygon(${size + overlap}px 0, 100% 0, 100% 100%, 0 100%, 0 ${size + overlap}px)`;
                      case 'topright':
                        return `polygon(0 0, calc(100% - ${size + overlap}px) 0, 100% ${size + overlap}px, 100% 100%, 0 100%)`;
                      case 'bottomleft':
                        return `polygon(0 0, 100% 0, 100% 100%, ${size + overlap}px 100%, 0 calc(100% - ${size + overlap}px))`;
                      case 'bottomright':
                        return `polygon(0 0, 100% 0, 100% calc(100% - ${size + overlap}px), calc(100% - ${size + overlap}px) 100%, 0 100%)`;
                      default:
                        return 'none';
                    }
                  })() : 'none'
                }}
              >
                <RectangleContent 
                    rect={rect} 
                    scrollPositions={scrollPositions}
                />

                {/* Folded corners with enhanced shadow effect */}
                {selectedId === rect.id && corners.map(corner => (
                  <div
                    key={corner}
                    style={{
                      position: 'absolute',
                      width: 0,
                      height: 0,
                      pointerEvents: 'none',
                      transition: 'all 0.15s ease-in-out',
                      opacity: hoveredCorner.id === rect.id && hoveredCorner.corner === corner ? 1 : 0,
                      ...(() => {
                        const size = 20;
                        const isHovered = hoveredCorner.id === rect.id && hoveredCorner.corner === corner;
                        const scale = isHovered ? 1.5 : 1;
                        const shadowIntensity = isHovered ? '0.3' : '0.2';
                        
                        const baseStyle = {
                          transform: `scale(${scale})`,
                        };

                        switch(corner) {
                          case 'topleft':
                            return {
                              ...baseStyle,
                              top: 0,
                              left: 0,
                              borderTop: `${size}px solid white`,
                              borderRight: `${size}px solid transparent`,
                              boxShadow: `2px 2px 4px rgba(0, 0, 0, ${shadowIntensity})`,
                              transformOrigin: 'top left'
                            };
                          case 'topright':
                            return {
                              ...baseStyle,
                              top: 0,
                              right: 0,
                              borderTop: `${size}px solid white`,
                              borderLeft: `${size}px solid transparent`,
                              boxShadow: `-2px 2px 4px rgba(0, 0, 0, ${shadowIntensity})`,
                              transformOrigin: 'top right'
                            };
                          case 'bottomleft':
                            return {
                              ...baseStyle,
                              bottom: 0,
                              left: 0,
                              borderBottom: `${size}px solid white`,
                              borderRight: `${size}px solid transparent`,
                              boxShadow: `2px -2px 4px rgba(0, 0, 0, ${shadowIntensity})`,
                              transformOrigin: 'bottom left'
                            };
                          case 'bottomright':
                            return {
                              ...baseStyle,
                              bottom: 0,
                              right: 0,
                              borderBottom: `${size}px solid white`,
                              borderLeft: `${size}px solid transparent`,
                              boxShadow: `-2px -2px 4px rgba(0, 0, 0, ${shadowIntensity})`,
                              transformOrigin: 'bottom right'
                            };
                        }
                      })()
                    }}
                  />
                ))}
              </div>

              {/* Interactive areas */}
              {selectedId === rect.id && (
                <>
                  {corners.map(corner => {
                    const x = padding + (corner.includes('right') ? rect.width : 0);
                    const y = padding + (corner.includes('bottom') ? rect.height : 0);
                    
                    // Move handle - positioned 30px inward from the corner
                    const moveOffset = 30;
                    const moveX = x + (corner.includes('right') ? -moveOffset : moveOffset);
                    const moveY = y + (corner.includes('bottom') ? -moveOffset : moveOffset);
                    
                    // Rotation handle - positioned 15px outward from the corner
                    const rotationOffset = 10;
                    const rotateX = x + (corner.includes('right') ? rotationOffset : -rotationOffset);
                    const rotateY = y + (corner.includes('bottom') ? rotationOffset : -rotationOffset);
                    
                    return (
                      <React.Fragment key={corner}>
                        {/* Move handle */}
                        <InteractiveArea
                          x={moveX}
                          y={moveY}
                          size={40}
                          cursor='move'
                          onMouseDown={(e) => handleMouseDown(e, rect.id, 'move')}
                          onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                          onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                        />
                        
                        {/* Rotation handle */}
                        <InteractiveArea
                          x={rotateX}
                          y={rotateY}
                          cursor={cursors.rotate}
                          onMouseDown={(e) => handleMouseDown(e, rect.id, 'rotate')}
                          onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                          onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                        />
                        
                        {/* Scale handle */}
                        <InteractiveArea
                          x={x}
                          y={y}
                          cursor={cursors.scale}

                          onMouseDown={(e) => handleMouseDown(e, rect.id, 'resize', corner)}
                          onMouseEnter={(e) => handleCornerHover(e, rect.id, corner)}
                          onMouseLeave={(e) => handleCornerLeave(e, rect.id)}
                        />
                      </React.Fragment>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
};

export default RectangleEditor;