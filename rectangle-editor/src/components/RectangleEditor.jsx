import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import ReactMarkdown from 'react-markdown';

const RectangleEditor = () => {
  const [selectedId, setSelectedId] = useState(null);
  const [action, setAction] = useState(null);
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });
  const [startRect, setStartRect] = useState(null);
  const [lastAngle, setLastAngle] = useState(0);
  const [hoveredCorner, setHoveredCorner] = useState({ id: null, corner: null });
  const [selectionOrder, setSelectionOrder] = useState([]);

  const canvasRef = useRef(null);
  const scrollPositions = useRef({});

  let initialWidth = window.innerWidth - (2 * 0.4 * window.innerWidth)
  let initialHeight = window.innerHeight - (2 * 0.4 * window.innerHeight)

  let message = "# Sample Markdown\n\nHover around the **corners** to edit the current page \n\n Outside a corner to **rotate** \n\n On a corner to **scale** \n\n Inside a corner to **drag**\n\n [**New Page**](command:addRectangle)\n\n Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec tincidunt odio nec orci aliquet ultricies. Maecenas nec faucibus sapien. Nulla id dolor sit amet quam malesuada cursus eget eu ex. Morbi non nibh pulvinar, feugiat eros a, consequat ex. Ut a dolor a enim tempus elementum eu condimentum lectus. Sed non orci sed magna pulvinar lobortis vitae a mi. Donec non feugiat elit. Duis congue odio et nisl pharetra faucibus. Curabitur eu cursus magna. Nunc non efficitur risus. Etiam aliquet faucibus ex, vitae mattis urna rhoncus et. Duis condimentum maximus semper. Praesent et magna purus. Integer sagittis in est vitae rutrum."

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
    
  // Initialize selection order with the initial rectangle
  useEffect(() => {
    setSelectionOrder([initialRect.id]);
  }, []);
    
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

  // Custom cursors
  const cursors = {
    move: `url("data:image/svg+xml;base64,${btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2">
        <path d="M12 2v20M2 12h20"/>
        <path d="M7 7l-5 5 5 5M17 7l5 5-5 5M7 17l5 5 5-5M7 7l5-5 5 5"/>
      </svg>
    `)}") 12 12, move`,
    
    rotate: `url("data:image/svg+xml;base64,${btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2">
        <path d="M21 12a9 9 0 11-3-6.7"/>
        <path d="M22 4V10H16"/>
      </svg>
    `)}") 12 12, crosshair`,
    
    scale: `url("data:image/svg+xml;base64,${btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2">
        <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>
      </svg>
    `)}") 12 12, nw-resize`
  };

  const isPointNearCorner = (mouseX, mouseY, rect, corner) => {
    const threshold = 55;
    
    // Get the center of the rectangle (the point of rotation)
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    
    // Convert rotation to radians
    const angleRad = (rect.rotation * Math.PI) / 180;
    const cos = Math.cos(-angleRad);
    const sin = Math.sin(-angleRad);
    
    // Translate mouse point relative to rectangle's center
    const relativeX = mouseX - centerX;
    const relativeY = mouseY - centerY;
    
    // Rotate the mouse coordinates to align with rectangle's coordinate system
    const rotatedMouseX = (relativeX * cos - relativeY * sin) + centerX;
    const rotatedMouseY = (relativeX * sin + relativeY * cos) + centerY;
    
    // Get corner coordinates in the original, unrotated space
    let cornerX, cornerY;
    switch(corner) {
        case 'topleft':
            cornerX = rect.x;
            cornerY = rect.y;
            break;
        case 'topright':
            cornerX = rect.x + rect.width;
            cornerY = rect.y;
            break;
        case 'bottomleft':
            cornerX = rect.x;
            cornerY = rect.y + rect.height;
            break;
        case 'bottomright':
            cornerX = rect.x + rect.width;
            cornerY = rect.y + rect.height;
            break;
    }
    
    // Calculate distance between rotated mouse point and corner
    const dx = rotatedMouseX - cornerX;
    const dy = rotatedMouseY - cornerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    return distance < threshold;
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

  // Function to get z-index based on selection order
  const getZIndex = (rectId) => {
    const index = selectionOrder.indexOf(rectId);
    // Higher index = higher z-index, base of 1
    return selectionOrder.length - index;
  };

  const handleMouseLeave = useCallback((e, rectId) => {
    e.stopPropagation();
    // Only clear if we're not entering a child element
    if (!e.relatedTarget?.closest(`[data-rect-id="${rectId}"]`)) {
        setSelectedId(null);
    }
  }, []);

const handleMouseMove = useCallback((e) => {
  if (!canvasRef.current) return;
  
  const canvas = canvasRef.current.getBoundingClientRect();
  const mouseX = e.clientX - canvas.left;
  const mouseY = e.clientY - canvas.top;

  let foundHover = false;
  for (const rect of rectangles) {
      if (rect.id === selectedId) {
          const corners = ['topleft', 'topright', 'bottomleft', 'bottomright'];

          for (const corner of corners) {
              if (isPointNearCorner(mouseX, mouseY, rect, corner)) {
                  setHoveredCorner({ id: rect.id, corner });
                  foundHover = true;
                  break;
              }
          }
          if (foundHover) break;
      }
  }

  if (!foundHover) {
      setHoveredCorner({ id: null, corner: null });
  }
}, [rectangles, selectedId]);

  useEffect(() => {
      const canvas = canvasRef.current;
      if (canvas) {
          canvas.addEventListener('mousemove', handleMouseMove);
          return () => canvas.removeEventListener('mousemove', handleMouseMove);
      }
  }, [handleMouseMove]);


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
        const parts = text.match(/(\[.*?\]\(command:addRectangle\))|([^\[]+)/g) || [];
        
        return parts.map((part, index) => {
            if (part.match(/\[.*?\]\(command:addRectangle\)/)) {
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
            
            return (
                <div key={index} style={{ fontFamily: 'Helvetica', fontSize: '16px' }}>
                    <ReactMarkdown>{part}</ReactMarkdown>
                </div>
            );
        });
    }, []);

    return (
        <div 
            ref={contentRef}
            className="absolute inset-0 p-4 overflow-auto select-text"
            onClick={(e) => e.stopPropagation()}
            onScroll={handleScroll}
            style={{ cursor: 'text' }}
        >
            <div className="prose prose-sm max-w-none">
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

  const handleMouseDown = (e, id, actionType, corner) => {
    if (!canvasRef.current) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const canvas = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - canvas.left;
    const mouseY = e.clientY - canvas.top;
    
    const rect = rectangles.find(r => r.id === id);
    if (!rect) return;

    setSelectedId(id);
    setAction({ type: actionType, corner });
    setStartPoint({ x: mouseX, y: mouseY });
    setStartRect({ ...rect });
    setLastAngle(rect.rotation);

    const handleMove = (moveEvent) => {
      const newMouseX = moveEvent.clientX - canvas.left;
      const newMouseY = moveEvent.clientY - canvas.top;
      const deltaX = newMouseX - mouseX;
      const deltaY = newMouseY - mouseY;

      setRectangles(prevRects => 
        prevRects.map(r => {
          if (r.id !== id) return r;

          if (actionType === 'move') {
            return {
              ...r,
              x: rect.x + deltaX,
              y: rect.y + deltaY
            };
          }

          if (actionType === 'rotate') {
            const center = getCenter(rect);
            const startAngle = getAngle(center, { x: mouseX, y: mouseY });
            const currentAngle = getAngle(center, { x: newMouseX, y: newMouseY });
            const deltaAngle = currentAngle - startAngle;
            
            return {
              ...r,
              rotation: rect.rotation + deltaAngle
            };
          }

          if (actionType === 'resize') {
            const angleRad = (rect.rotation * Math.PI) / 180;
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);

            // Get the center of the rectangle
            const centerX = rect.x + rect.width / 2;
            const centerY = rect.y + rect.height / 2;

            // Rotate the mouse delta to align with rectangle's coordinate system
            const relativeMouseX = newMouseX - centerX;
            const relativeMouseY = newMouseY - centerY;
            const rotatedMouseX = relativeMouseX * cos + relativeMouseY * sin;
            const rotatedMouseY = -relativeMouseX * sin + relativeMouseY * cos;

            const relativeStartX = mouseX - centerX;
            const relativeStartY = mouseY - centerY;
            const rotatedStartX = relativeStartX * cos + relativeStartY * sin;
            const rotatedStartY = -relativeStartX * sin + relativeStartY * cos;

            const deltaLocalX = rotatedMouseX - rotatedStartX;
            const deltaLocalY = rotatedMouseY - rotatedStartY;

            let newWidth = rect.width;
            let newHeight = rect.height;
            let newX = rect.x;
            let newY = rect.y;

            switch(corner) {
              case 'topleft':
                newWidth = rect.width - deltaLocalX;
                newHeight = rect.height - deltaLocalY;
                
                // Calculate new position based on bottom-right point
                newX = centerX - newWidth / 2 + (deltaLocalX * cos / 2) - (deltaLocalY * sin / 2);
                newY = centerY - newHeight / 2 + (deltaLocalX * sin / 2) + (deltaLocalY * cos / 2);
                break;

              case 'topright':
                newWidth = rect.width + deltaLocalX;
                newHeight = rect.height - deltaLocalY;
                
                // Calculate new position based on bottom-left point
                newX = centerX - newWidth / 2 + (deltaLocalX * cos / 2) - (deltaLocalY * sin / 2);
                newY = centerY - newHeight / 2 + (deltaLocalX * sin / 2) + (deltaLocalY * cos / 2);
                break;

              case 'bottomleft':
                newWidth = rect.width - deltaLocalX;
                newHeight = rect.height + deltaLocalY;
                
                // Calculate new position based on top-right point
                newX = centerX - newWidth / 2 + (deltaLocalX * cos / 2) - (deltaLocalY * sin / 2);
                newY = centerY - newHeight / 2 + (deltaLocalX * sin / 2) + (deltaLocalY * cos / 2);
                break;

              case 'bottomright':
                newWidth = rect.width + deltaLocalX;
                newHeight = rect.height + deltaLocalY;
                
                // Calculate new position based on top-left point
                newX = centerX - newWidth / 2 + (deltaLocalX * cos / 2) - (deltaLocalY * sin / 2);
                newY = centerY - newHeight / 2 + (deltaLocalX * sin / 2) + (deltaLocalY * cos / 2);
                break;
            }

            // Ensure minimum size
            newWidth = Math.max(50, newWidth);
            newHeight = Math.max(50, newHeight);

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
      setStartRect(null);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleCornerHover = (id, corner) => {
    setHoveredCorner({ id, corner });
  };

  const handleCornerLeave = () => {
    setHoveredCorner({ id: null, corner: null });
  };

  return (
    <div>
      <div ref={canvasRef}>
        {rectangles.map((rect) => {
          const corners = ['topleft', 'topright', 'bottomleft', 'bottomright'];
          const padding = 20;

          return (
            <div 
              key={rect.id} 
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
                    const rotationOffset = 15;
                    const rotateX = x + (corner.includes('right') ? rotationOffset : -rotationOffset);
                    const rotateY = y + (corner.includes('bottom') ? rotationOffset : -rotationOffset);
                    
                    return (
                      <React.Fragment key={corner}>
                        {/* Move handle */}
                        <InteractiveArea
                          x={moveX}
                          y={moveY}
                          size={40}
                          cursor={cursors.move}
                          onMouseDown={(e) => handleMouseDown(e, rect.id, 'move')}
                        />
                        
                        {/* Rotation handle */}
                        <InteractiveArea
                          x={rotateX}
                          y={rotateY}
                          cursor={cursors.rotate}
                          onMouseDown={(e) => handleMouseDown(e, rect.id, 'rotate')}
                        />
                        
                        {/* Scale handle */}
                        <InteractiveArea
                          x={x}
                          y={y}
                          cursor={cursors.scale}
                          onMouseDown={(e) => handleMouseDown(e, rect.id, 'resize', corner)}
                          onMouseEnter={() => handleCornerHover(rect.id, corner)}
                          onMouseLeave={handleCornerLeave}
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
  );
};

export default RectangleEditor;