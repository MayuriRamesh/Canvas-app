import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import axios from 'axios';
import getStroke from "perfect-freehand";
import "./style.css";

const nearPoint = (x, y, x1, y1, name) => {
  return Math.abs(x - x1) < 5 && Math.abs(y - y1) < 5 ? name : null;
};

const onLine = (x1, y1, x2, y2, x, y, maxDistance = 1) => {
  const a = { x: x1, y: y1 };
  const b = { x: x2, y: y2 };
  const c = { x, y };
  const offset = distance(a, b) - (distance(a, c) + distance(b, c));
  return Math.abs(offset) < maxDistance ? "inside" : null;
};

const positionWithinElement = (x, y, element) => {
  const { type, x1, x2, y1, y2 } = element;
  switch (type) {
    case "line":
      const on = onLine(x1, y1, x2, y2, x, y);
      const start = nearPoint(x, y, x1, y1, "start");
      const end = nearPoint(x, y, x2, y2, "end");
      return start || end || on;
    case "rectangle":
      const topLeft = nearPoint(x, y, x1, y1, "tl");
      const topRight = nearPoint(x, y, x2, y1, "tr");
      const bottomLeft = nearPoint(x, y, x1, y2, "bl");
      const bottomRight = nearPoint(x, y, x2, y2, "br");
      const inside = x >= x1 && x <= x2 && y >= y1 && y <= y2 ? "inside" : null;
      return topLeft || topRight || bottomLeft || bottomRight || inside;
    case "pencil":
      const betweenAnyPoint = element.points.some((point, index) => {
        const nextPoint = element.points[index + 1];
        if (!nextPoint) return false;
        return onLine(point.x, point.y, nextPoint.x, nextPoint.y, x, y, 5) != null;
      });
      return betweenAnyPoint ? "inside" : null;
    case "text":
      return x >= x1 && x <= x2 && y >= y1 && y <= y2 ? "inside" : null;
    default:
      throw new Error(`Type not recognised: ${type}`);
  }
};

const distance = (a, b) => Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

const getElementAtPosition = (x, y, elements) => {
  return elements
    .map(element => ({ ...element, position: positionWithinElement(x, y, element) }))
    .find(element => element.position !== null);
};

const adjustElementCoordinates = element => {
  const { type, x1, y1, x2, y2 } = element;
  if (type === "rectangle") {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    return { x1: minX, y1: minY, x2: maxX, y2: maxY };
  } else {
    if (x1 < x2 || (x1 === x2 && y1 < y2)) {
      return { x1, y1, x2, y2 };
    } else {
      return { x1: x2, y1: y2, x2: x1, y2: y1 };
    }
  }
};

const cursorForPosition = position => {
  switch (position) {
    case "tl":
    case "br":
    case "start":
    case "end":
      return "nwse-resize";
    case "tr":
    case "bl":
      return "nesw-resize";
    default:
      return "move";
  }
};

const resizedCoordinates = (clientX, clientY, position, coordinates) => {
  const { x1, y1, x2, y2 } = coordinates;
  switch (position) {
    case "tl":
    case "start":
      return { x1: clientX, y1: clientY, x2, y2 };
    case "tr":
      return { x1, y1: clientY, x2: clientX, y2 };
    case "bl":
      return { x1: clientX, y1, x2, y2: clientY };
    case "br":
    case "end":
      return { x1, y1, x2: clientX, y2: clientY };
    default:
      return null; //should not really get here...
  }
};

const useHistory = initialState => {
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([initialState]);

  const setState = (action, overwrite = false) => {
    const newState = typeof action === "function" ? action(history[index]) : action;
    if (overwrite) {
      const historyCopy = [...history];
      historyCopy[index] = newState;
      setHistory(historyCopy);
    } else {
      const updatedState = [...history].slice(0, index + 1);
      setHistory([...updatedState, newState]);
      setIndex(prevState => prevState + 1);
    }
  };

  const undo = () => index > 0 && setIndex(prevState => prevState - 1);
  const redo = () => index < history.length - 1 && setIndex(prevState => prevState + 1);

  return [history[index], setState, undo, redo];
};

const getSvgPathFromStroke = stroke => {
  if (!stroke.length) return "";

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );

  d.push("Z");
  return d.join(" ");
};


const drawElement = (context, element) => {
  switch (element.type) {
    case "line":
      context.beginPath();
      context.moveTo(element.x1, element.y1);
      context.lineTo(element.x2, element.y2);
      context.stroke();
      break;
    case "rectangle":
      context.strokeRect(element.x1, element.y1, element.x2 - element.x1, element.y2 - element.y1);
      break;
    case "pencil":
      const stroke = getStroke(element.points);
      const path = new Path2D(getSvgPathFromStroke(stroke));
      context.fill(path);
      break;
    case "text":
      context.textBaseline = "top";
      context.font = "24px sans-serif";
      context.fillText(element.text, element.x1, element.y1);
      break;
    default:
      throw new Error(`Type not recognised: ${element.type}`);
  }
};

const adjustmentRequired = type => ["line", "rectangle"].includes(type);

const usePressedKeys = () => {
  const [pressedKeys, setPressedKeys] = useState(new Set());

  useEffect(() => {
    const handleKeyDown = event => {
      setPressedKeys(prevKeys => new Set(prevKeys).add(event.key));
    };

    const handleKeyUp = event => {
      setPressedKeys(prevKeys => {
        const updatedKeys = new Set(prevKeys);
        updatedKeys.delete(event.key);
        return updatedKeys;
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return pressedKeys;
};



const App = () => {
  const [elements, setElements, undo, redo] = useHistory([]);
  const [action, setAction] = useState("none");
  const [tool, setTool] = useState("rectangle");
  const [selectedElement, setSelectedElement] = useState(null);
  const [panOffset, setPanOffset] = React.useState({ x: 0, y: 0 });
  const [startPanMousePosition, setStartPanMousePosition] = React.useState({ x: 0, y: 0 });
  const textAreaRef = useRef();
  const pressedKeys = usePressedKeys();
  const [tabOrder, setTabOrder] = useState(0); // Step 1: Tab order state

  const [showDropdown, setShowDropdown] = useState(false); //file dropdown
  const [entities, setEntities] = useState([]);
  const [selectedEntityName, setSelectedEntityName] = useState(''); //select the name from DB list
  const canvasRef = useRef(null);

  const [isListOpen, setIsListOpen] = useState(true);  //list open/close
  const entityListRef = useRef(null);  //The event listener checks if the clicked target is outside the entity-list div using the listRef reference. If the click is detected outside the list, the list is closed (isListOpen is set to false).

  const [selectedEntityPosition, setSelectedEntityPosition] = useState({ x: 0, y: 0 });   //setting coordinates to move the DB entities on canvas

  useEffect(() => {
        console.log("Entities updated in useEffect:", entities);
        }, [entities]);

  //   useEffect(() => {
  //   //function is a callback that is invoked whenever a click event occurs anywhere on the document 
  //   //(i.e., the entire web page). Its purpose in the given code is to determine whether the click event occurred outside of the entity list
  //   // (the dropdown) and, if so, close the list.
  //   const handleDocumentClick = (event) => {
  //     if (entityListRef.current && !entityListRef.current.contains(event.target)) {
  //       setIsListOpen(false);
  //     }
  //   };

  //   window.addEventListener('click', handleDocumentClick);

  //   return () => {
  //     window.removeEventListener('click', handleDocumentClick);
  //   };
  // }, []); 
  
  
  useEffect(() => {
    const handleDocumentClick = (event) => {
      // Get the canvas element
      const canvas = canvasRef.current;
  
      // Check if the clicked target is outside the entity list and the canvas
      if (
        entityListRef.current &&
        !entityListRef.current.contains(event.target) &&
        !canvas.contains(event.target)
      ) {
        setIsListOpen(false);
      }
    };
  
    window.addEventListener('click', handleDocumentClick);
  
    return () => {
      window.removeEventListener('click', handleDocumentClick);
    };
  }, []);
  
  

  const handleDBImageClick = () => {
    // setIsListOpen(prevIsListOpen => !prevIsListOpen); // Toggle the list open/close state
    console.log('handleImageClick triggered');
    console.log('Before state update - isListOpen:', isListOpen);
    // setIsListOpen(!isListOpen);
    
    
  // Close the list if it's open
  // if (isListOpen) {
  //   // If the list is already open, close it
  //   setIsListOpen(false);
  // } else {
  //   // If the list is not open, open it
  //   setIsListOpen(true);
    
    
  if (isListOpen) {
    setIsListOpen(false);
    axios.get('http://127.0.0.1:4000/select_labels')
    .then(response => {
    const responseData = response.data.data; // Access the 'data' property
console.log("resssssssssssponseeee",response)
console.log("resssssssssssponseeee 2",responseData)
    // Assuming the response is an array of entities
    if (Array.isArray(responseData)) {
      setEntities(responseData);
      console.log("Entities updated:", responseData);
      
    } else {
      console.error('Invalid response format:', responseData);
      
    }
  })
  .catch(error => {
    console.error('Error fetching entities:', error);
  });
  }
  else{
    setIsListOpen(true);
    setEntities([]);
  }
console.log('isListOpen:', isListOpen);
console.log('After state update - isListOpen:', isListOpen);
  };

  const handleEntityClick = (entityName) => {
    setSelectedEntityName(entityName);
    setIsListOpen(false);
    console.log("selecteddddddddddddd nameeeeeeee",entityName);
    const entityPosition = { x: 100, y: 100 }; // Replace with actual coordinates
  setSelectedEntityPosition(entityPosition);
  };

  // const handleClickOutsideDBimg = (event) => {                  //to close the database list
  //   if (entityListRef.current && !entityListRef.current.contains(event.target)) {
  //     setIsListOpen(false);
  //   }
  // };



  const handleWeightDBImageClick = () => {
    console.log('handleImageClick triggered');
        
    axios.get('http://127.0.0.1:4000/select_labels')
    .then(response => {
    const responseData = response.data.data; // Access the 'data' property
console.log("resssssssssssponseeee",response)
console.log("resssssssssssponseeee 2",responseData)
    // Assuming the response is an array of entities
    if (Array.isArray(responseData)) {
      setEntities(responseData);
      console.log("Entities updated:", responseData);
      
    } else {
      console.error('Invalid response format:', responseData);
      
    }
  })
  .catch(error => {
    console.error('Error fetching entities:', error);
  });
  };

  const handleTimeDBImageClick = () => {
    console.log('handleImageClick triggered');
    
    
    axios.get('http://127.0.0.1:4000/select_labels')
    .then(response => {
    const responseData = response.data.data; // Access the 'data' property
console.log("resssssssssssponseeee",response)
console.log("resssssssssssponseeee 2",responseData)
    // Assuming the response is an array of entities
    if (Array.isArray(responseData)) {
      setEntities(responseData);
      console.log("Entities updated:", responseData);
      
    } else {
      console.error('Invalid response format:', responseData);
      
    }
  })
  .catch(error => {
    console.error('Error fetching entities:', error);
  });
  };



/***************************************************************************** */
  // Toggle the dropdown visibility for file label open
  function toggleDropdown() {
    setShowDropdown((prevShowDropdown) => !prevShowDropdown);
  }

  // Close the dropdown if the user clicks outside of it
  function handleClickOutside(event) {
    if (!event.target.matches('.dropbtn')) {
      setShowDropdown(false);
    }
  }

  // Attach the event listener for clicks outside the dropdown
  React.useEffect(() => {
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);
 /***************************************************************************** */ 

  useLayoutEffect(() => {
    const canvas = document.getElementById("canvas");
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(panOffset.x, panOffset.y);

    elements.forEach(element => {
      if (action === "writing" && selectedElement.id === element.id) return;
      drawElement(context, element);
    });
    context.restore();
  }, [elements, action, selectedElement, panOffset]);

  useEffect(() => {
    const undoRedoFunction = event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "z") {
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };

    document.addEventListener("keydown", undoRedoFunction);
    return () => {
      document.removeEventListener("keydown", undoRedoFunction);
    };
  }, [undo, redo]);

  useEffect(() => {
    const panFunction = event => {
      setPanOffset(prevState => ({
        x: prevState.x - event.deltaX,
        y: prevState.y - event.deltaY,
      }));
    };

    document.addEventListener("wheel", panFunction);
    return () => {
      document.removeEventListener("wheel", panFunction);
    };
  }, []);

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (action === "writing") {
      setTimeout(() => {
        textArea.focus();
        textArea.value = selectedElement.text;  //when we click on text to edit, the existing text will show as it is to edit.
        //text.push(selectedElement.text)
      }, 0);
    }
  }, [action, selectedElement]);

  const createElement = (id, x1, y1, x2, y2, type) => {
     switch (type) {
      case "line":
        return { id, x1, y1, x2, y2, type };
      case "rectangle":
        return { id, x1, y1, x2, y2, type };
      case "pencil":
        return { id, type, points: [{ x: x1, y: y1 }] };
      case "text":
        // return { id, type, x1, y1, x2, y2, text: "" };
        
        // Step 2: Include tabOrder for text elements
        const element = { id, type, x1, y1, x2, y2, text: "" };
        if (type === "text") {
          element.tabOrder = tabOrder;
          setTabOrder(prevTabOrder => prevTabOrder + 1); // Step 3: Increment tab order for the next text element
        }
        return element;
        
      default:
        throw new Error(`Type not recognised: ${type}`);
    }
  };

  const updateElement = (id, x1, y1, x2, y2, type, options) => {
    const elementsCopy = [...elements];

    switch (type) {
      case "line":
      case "rectangle":
        elementsCopy[id] = createElement(id, x1, y1, x2, y2, type);
        break;
      case "pencil":
        elementsCopy[id].points = [...elementsCopy[id].points, { x: x2, y: y2 }];
        break;
      case "text":
        const textWidth = document
          .getElementById("canvas")
          .getContext("2d")
          .measureText(options.text).width;
        const textHeight = 20;
        elementsCopy[id] = {
          ...createElement(id, x1, y1, x1 + textWidth, y1 + textHeight, type),
          text: options.text,
        };
        break;
      default:
        throw new Error(`Type not recognised: ${type}`);
    }

    setElements(elementsCopy, true);
  };

  const getMouseCoordinates = event => {
    const clientX = event.clientX - 100 //panOffset.x;
    const clientY = event.clientY - 100 //panOffset.y;
    return { clientX, clientY };
  };

  const handleMouseDown = (event, canvasContext) => {
    if (action === "writing") return;

    const { clientX, clientY } = getMouseCoordinates(event);

    if (event.button === 1 || pressedKeys.has(" ")) {
      setAction("panning");
      setStartPanMousePosition({ x: clientX, y: clientY });
      return;
    }

    if (tool === "selection") {
      const element = getElementAtPosition(clientX, clientY, elements);
/**************************************************************************************************************************** */
          // Check if the mouse is within the bounding box of the entity name
    const canvas = canvasRef.current;
    const canvasRect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - canvasRect.left;
    const mouseY = event.clientY - canvasRect.top;

    // Check if the mouse is over the entity name
    const entityNameRect = {
      x: 190 + panOffset.x,
      y: 100 + panOffset.y,
      width: canvasContext.measureText(selectedEntityName).width,
      height: 16, // Adjust this value as needed
    };

      if (
      mouseX >= entityNameRect.x &&
      mouseX <= entityNameRect.x + entityNameRect.width &&
      mouseY >= entityNameRect.y &&
      mouseY <= entityNameRect.y + entityNameRect.height
      ) {
        // Start the drag operation for the entity name
        canvas.style.cursor = "move"; // Change the cursor to 'move'
        setAction("dragging");
        setStartPanMousePosition({ x: clientX, y: clientY });
      }
/******************************************************************************************************************** */
      if (element) {
        if (element.type === "pencil") {
          const xOffsets = element.points.map(point => clientX - point.x);
          const yOffsets = element.points.map(point => clientY - point.y);
          setSelectedElement({ ...element, xOffsets, yOffsets });
        } else {
          const offsetX = clientX - element.x1;
          const offsetY = clientY - element.y1;
          setSelectedElement({ ...element, offsetX, offsetY });
        }
        setElements(prevState => prevState);

        if (element.position === "inside") {
          setAction("moving");
        } else {
          setAction("resizing");
        }
      }
    } else {
      const id = elements.length;
      const element = createElement(id, clientX, clientY, clientX, clientY, tool);
      setElements(prevState => [...prevState, element]);
      setSelectedElement(element);

      setAction(tool === "text" ? "writing" : "drawing");
    }
  };

  
  const handleMouseMove = event => {
    const { clientX, clientY } = getMouseCoordinates(event);

    if (action === "panning") {
      const deltaX = clientX - startPanMousePosition.x;
      const deltaY = clientY - startPanMousePosition.y;
      setPanOffset({
        x: panOffset.x + deltaX,
        y: panOffset.y + deltaY,
      });
      return;
    }

    if (tool === "selection") {
      const element = getElementAtPosition(clientX, clientY, elements);
      event.target.style.cursor = element ? cursorForPosition(element.position) : "default";
    }

    if (action === "drawing") {
      const index = elements.length - 1;
      const { x1, y1 } = elements[index];
      updateElement(index, x1, y1, clientX, clientY, tool);
    } else if (action === "moving") {
      if (selectedElement.type === "pencil") {
        const newPoints = selectedElement.points.map((_, index) => ({
          x: clientX - selectedElement.xOffsets[index],
          y: clientY - selectedElement.yOffsets[index],
        }));
        const elementsCopy = [...elements];
        elementsCopy[selectedElement.id] = {
          ...elementsCopy[selectedElement.id],
          points: newPoints,
        };
        setElements(elementsCopy, true);
      } else {
        const { id, x1, x2, y1, y2, type, offsetX, offsetY } = selectedElement;
        const width = x2 - x1;
        const height = y2 - y1;
        const newX1 = clientX - offsetX;
        const newY1 = clientY - offsetY;
        const options = type === "text" ? { text: selectedElement.text } : {};
        updateElement(id, newX1, newY1, newX1 + width, newY1 + height, type, options);
      }
    } else if (action === "resizing") {
      const { id, type, position, ...coordinates } = selectedElement;
      const { x1, y1, x2, y2 } = resizedCoordinates(clientX, clientY, position, coordinates);
      updateElement(id, x1, y1, x2, y2, type);
    }
    /******************************************************************************************* */
    // If dragging the entity name
  if (action === "dragging") {
    const deltaX = clientX - startPanMousePosition.x;
    const deltaY = clientY - startPanMousePosition.y;
    setStartPanMousePosition({ x: clientX, y: clientY });

    // Update the entity name position
    setPanOffset(prevPanOffset => ({
      x: prevPanOffset.x + deltaX,
      y: prevPanOffset.y + deltaY,
    }));
    return;
  } /***************************************************************************************** */
  };


  

  const handleMouseUp = event => {
    const { clientX, clientY } = getMouseCoordinates(event);
    if (selectedElement) {
      if (
        selectedElement.type === "text" &&
        clientX - selectedElement.offsetX === selectedElement.x1 &&
        clientY - selectedElement.offsetY === selectedElement.y1
      ) {
        setAction("writing");
        return;
      }

      const index = selectedElement.id;
      const { id, type } = elements[index];
      if ((action === "drawing" || action === "resizing") && adjustmentRequired(type)) {
        const { x1, y1, x2, y2 } = adjustElementCoordinates(elements[index]);
        updateElement(id, x1, y1, x2, y2, type);
      }
    }

    if (action === "writing") return;

    // If dragging the entity name
  if (action === "dragging") {
    setAction("none");
    return;
  }

    setAction("none");
    setSelectedElement(null);
  
  };


  

  const handleBlur = event => {
    const { id, x1, y1, type } = selectedElement;
    setAction("none");
    setSelectedElement(null);
    // Step 5: Update tab order when a text element is committed
    const newText = event.target.value;
    updateElement(id, x1, y1, null, null, type, { text: newText, tabOrder: selectedElement.tabOrder });
  };


  const handleSaveImage = () => {
    const canvas = document.getElementById("canvas");
    const link = document.createElement("a"); // creating <a> element
    link.download = `${Date.now()}.jpg`; // set the file name for the downloaded image
    link.href = canvas.toDataURL(); // set the canvas data as link href value
    link.click(); // simulate clicking the link to download the image
  };

  const serializeCanvas = (elements) => {
    return JSON.stringify(elements);
  };
  const deserializeCanvas = (data) => {
    return JSON.parse(data);
  };
  const handleSaveFile = () => {
    const canvas = document.getElementById("canvas");
    const serializedData = serializeCanvas(elements);
    const blob = new Blob([serializedData], { type: "application/json" });
    const link = document.createElement("a");
    link.download = `${Date.now()}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
  };
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target.result;
        const deserializedElements = deserializeCanvas(data);
        setElements(deserializedElements);
      };
      reader.readAsText(file);
    }
  };
  

   
  // Step 4: Add helper function to update tab order after deletion
  const updateTabOrderAfterDeletion = deletedTabOrder => {
    const updatedElements = elements.map(element => {
      if (element.type === "text" && element.tabOrder > deletedTabOrder) {
        return { ...element, tabOrder: element.tabOrder - 1 };
      }
      return element;
    });
    setElements(updatedElements, true);
    setTabOrder(prevTabOrder => prevTabOrder - 1);
  };

   
    // Step 6: Add handleDelete function
  const handleDelete = () => {
    if (selectedElement) {
      const index = selectedElement.id;
      if (selectedElement.type === "text") {
        updateTabOrderAfterDeletion(selectedElement.tabOrder); // Step 4: Update tab order after deletion
      }
      const updatedElements = elements.filter(element => element.id !== index);
      setElements(updatedElements, true);
      setSelectedElement(null);
    }
  };

// Step 6: Function to update tabOrder of the selected element

const handleTabOrderChange = event => {
  const newTabOrder = parseInt(event.target.value);
  if (!isNaN(newTabOrder)) {
    const updatedElements = elements.map(element => {
      if (element.id === selectedElement.id) {
        return { ...element, tabOrder: newTabOrder };
      }
      return element;
    });
    setElements(updatedElements, true);
  }
};


// Step 2: Add a useEffect to update tabOrder when undo or redo is called
useEffect(() => {
  setTabOrder(elements.length); // Update tabOrder when undo or redo is called
}, [elements]);

const drawCanvas = () => {
  const canvas = canvasRef.current;
  const ctx = canvas.getContext('2d');

  // Clear the canvas
  // ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw your other canvas content here
  elements.forEach(element => {
    drawElement(ctx, element);
  });
  // Draw the selected entity name

  ctx.font = '16px Arial';
  ctx.fillStyle = 'black';
  // ctx.fillText(`Selected Entity: ${selectedEntityName}`, 10, canvas.height - 20);
  const adjustedX = 190 + panOffset.x;
  const adjustedY = 100 + panOffset.y;
  ctx.fillText(` ${selectedEntityName}`,adjustedX,adjustedY)
  
};

// Call drawCanvas whenever the selected entity name changes
useEffect(() => {
  drawCanvas();
}, [selectedEntityName]);

/************************************************************************ */

       

    return (
    <body>
    <div className="container">
      
      <section className="tools-board">
        <div>
         
            <div className="dropdown">
              <button onClick={toggleDropdown} className="dropbtn">File</button>&emsp;
              <div id="myDropdown" className={`dropdown-content ${showDropdown ? 'show' : ''}`}>
                <a href="#home">New</a>
                {/* <a href="#about" onClick={handleFileUpload}>Open</a> */}
                <input
                    type="file"
                    id="fileInput"
                    onChange={handleFileUpload}
                    style={{ display: "none" }}
                  />
                  <label htmlFor="fileInput" style={{ cursor: "pointer", padding: "8px 12px" }}>
                    Open
                  </label>

                {/* <a href="#contact">Save</a> */}
                <a href="#home" onClick={handleSaveFile}>Save</a>
              </div>
            </div>

          <label className="title">View</label>&emsp;

          {/* <label class="title">Save File</label> */}
          <img width="24" height="24" padding="1" src="https://img.icons8.com/external-flaticons-flat-flat-icons/64/external-save-file-web-flaticons-flat-flat-icons.png" alt="external-save-file-web-flaticons-flat-flat-icons"  onClick={handleSaveImage} title="Click to Save Image"/>&emsp;
          <img width="16" height="16" src="https://img.icons8.com/tiny-color/16/undo.png" alt="undo" onClick={undo} title="Undo"/>&emsp;
          {/* <button onClick={undo}>Undo</button>&emsp; */}
          {/* <button onClick={redo}>Redo</button> */}
          <img width="16" height="16" src="https://img.icons8.com/tiny-color/16/redo.png" alt="redo" onClick={redo} title="Redo"/>
          <hr style={{color:"#f4f0ec", width:"590%",height:"0.1px"}}></hr>
        </div>
        
        {/* <div className="row shape" style={{ position: "fixed", paddingTop: "1.2cm" }}> */}
        <div>
        <img width="24" height="27" src="https://img.icons8.com/external-itim2101-flat-itim2101/64/000000/external-printer-school-stationery-itim2101-flat-itim2101.png" alt="external-printer-school-stationery-itim2101-flat-itim2101"/>&emsp;&nbsp;
        <img width="36" height="26" src="https://img.icons8.com/glyph-neue/64/000000/barcode.png" alt="barcode"/>&emsp;&nbsp;
        <img width="24" height="24" src="https://img.icons8.com/external-sbts2018-outline-sbts2018/58/external-qr-code-black-friday-5-basic-sbts2018-outline-sbts2018.png" alt="external-qr-code-black-friday-5-basic-sbts2018-outline-sbts2018"/>&emsp;&nbsp;
       
        {/* <div onClick={handleOutsideClick}> */}
          <img
            width="28"
            height="27"
            src="https://img.icons8.com/offices/30/database-export.png"
            alt="database-daily-export"
            onClick={handleDBImageClick}
            style={{ cursor: 'pointer' }}
          />&emsp;&nbsp;
          {/* {isListOpen && ( */}
          <div className={`entity-list ${isListOpen ? 'open' : ''}`} >
              
              {entities.length> 0 ? (
                <ul>
                                  
                    {/* {(() => {
                    const listItems = [];
                    for (let i = 0; i < entities.length; i++) {
                      const entity = entities[i];
                      listItems.push(<li key={entity.id}>{entity.name}</li>);
                    }
                    return listItems;
                  })()} */}

                  {entities.map(entity => (
                          <li key={entity.id} onClick={() => handleEntityClick(entity.name)} className={selectedEntityName === entity.name ? 'selected' : ''}>
                            {entity.name}
                          </li>
                        ))}
                 
                </ul>
              ):(<p> </p>
              )}
            </div>
          {/* )} */}
            
        <img width="28" height="29" src="https://img.icons8.com/color/48/weight-kg.png" alt="weight-kg" onClick={handleWeightDBImageClick}
            style={{ cursor: 'pointer' }}/>&emsp;&nbsp;
        <img width="28" height="28" src="https://img.icons8.com/offices/30/database-daily-export.png" alt="database-export"onClick={handleTimeDBImageClick}
            style={{ cursor: 'pointer' }}/>&emsp;&nbsp;
         
         <input
          type="radio"
          id="selection"
          checked={tool === "selection"}
          onChange={() => setTool("selection")}
        />
        <label htmlFor="selection">Selection</label>&emsp;
       

        <input type="radio" id="line" checked={tool === "line"} onChange={() => setTool("line")} />
        <img width="24" height="24" src="https://img.icons8.com/color/48/line.png" alt="line"/>&emsp;
        {/* <label htmlFor="line">Line</label>&emsp; */}
       

        <input
          type="radio"
          id="rectangle"
          checked={tool === "rectangle"}
          onChange={() => setTool("rectangle")}
        />
         <img width="26" height="23" src="https://img.icons8.com/fluency/48/rectangle-stroked.png" alt="rectangle-stroked"/>&emsp;
        {/* <span htmlFor="rectangle">Rectangle</span>&emsp; */}
       
        <input
          type="radio"
          id="pencil"
          checked={tool === "pencil"}
          onChange={() => setTool("pencil")}
        />
        <img width="25" height="22" src="https://img.icons8.com/external-itim2101-flat-itim2101/64/external-pencil-school-stationery-itim2101-flat-itim2101.png" alt="external-pencil-school-stationery-itim2101-flat-itim2101"/>&emsp;
        {/* <label htmlFor="pencil">Pencil</label>&emsp; */}
        
        <input type="radio" id="text" checked={tool === "text"} onChange={() => setTool("text")} />
        <img width="24" height="24" src="https://img.icons8.com/fluency/48/text-color.png" alt="text-color"/>&emsp;&emsp;&nbsp;
        {/* <label htmlFor="text">Text</label> */}

        <img width="30" height="30" src="https://img.icons8.com/color-glass/48/picture.png" alt="pic" />
        <hr style={{color:"#fff9f7", width:"590%"}}></hr>
      </div>
      <div>
        <label for="label-size"> Label Template Size : </label>
        <input type="text" id="label-size" name="label-size"/>&emsp;
        <label for="label-name"> Label Name : </label>
        <input type="text" id="label-name" name="label-name"/>&emsp;
        <button>Barcode Format</button>&emsp;
        <button>QR-code Format</button>
      </div>
      </section>
      {action === "writing" ? (
        <textarea
          ref={textAreaRef}
          onBlur={handleBlur}
          style={{
            position: "fixed",
            top: selectedElement.y1 + panOffset.y - 2,
            left: selectedElement.x1 + panOffset.x,
            font: "24px sans-serif",
            margin: 0,
            padding: 0,
            border: 0,
            outline: 0,
            resize: "auto",
            overflow: "hidden",
            whiteSpace: "pre",
            background: "transparent",
            zIndex: 2,
          }}
        />
      ) : null}
       
      
        <section className="drawing-board">
        <div>
          <label><b>Behaviour</b></label>
          <hr style={{color:"#f4f0ec", width:"590%",height:"0.1px"}}></hr>

          <label for="tab-o">
            Tab Order:
             <input
                id="tab-o"
                type="number"
                // value={selectedElement.tabOrder}
                value={selectedElement?.type === "text" ? selectedElement.tabOrder : ""}
                onChange={handleTabOrderChange}
              />
            
            {/* Add a button to delete the selected element */}
            <button onClick={handleDelete}>Delete</button>
          </label>
          <hr style={{color:"#f4f0ec", width:"590%",height:"0.1px"}}></hr>
          
          <label><b>Misc</b></label>
          <hr style={{color:"#f4f0ec", width:"590%",height:"0.1px"}}></hr>

          <label for="font">Font Size :
          <input type="number" id="font" name="font"/></label><br/>

          <label for="style">Style :
          <input type="text" id="style" name="style"/></label><br/>

          <label for="H-R">Height-Ratio :
          <input type="number" id="H-R" name="H-R"/></label>
          <hr style={{color:"#f4f0ec", width:"590%",height:"0.1px"}}></hr>
        </div> 
        <div>
        <canvas
          id="canvas"
          width={window.innerWidth}
          ref={canvasRef}
          height={window.innerHeight}
          // onMouseDown={handleMouseDown}
          // onMouseDown={event => handleMouseDown(event, canvasRef.current.getContext('2d'))}
          // onMouseMove={handleMouseMove}
          // onMouseUp={handleMouseUp}
          // style={{ position: "absolute", zIndex: 1 }}
          onMouseDown={event => handleMouseDown(event, canvasRef.current.getContext('2d'))}
          onMouseMove={event => {
            const canvas = canvasRef.current;
            const canvasRect = canvas.getBoundingClientRect();
            const mouseX = event.clientX - canvasRect.left;
            const mouseY = event.clientY - canvasRect.top;
        
            // Check if the mouse is over the entity name
            const entityNameRect = {
              x: 130 + panOffset.x,
              y: 50 + panOffset.y,
              width: canvasRef.current.getContext('2d').measureText(selectedEntityName).width,
              height: 16, // Adjust this value as needed
            };
        
            if (
              mouseX >= entityNameRect.x &&
              mouseX <= entityNameRect.x + entityNameRect.width &&
              mouseY >= entityNameRect.y &&
              mouseY <= entityNameRect.y + entityNameRect.height
            ) {
              canvas.style.cursor = "move"; // Change the cursor to 'move'
            } else {
              canvas.style.cursor = "default"; // Change the cursor back to 'default'
            }
        
            handleMouseMove(event);
          }}
          onMouseUp={handleMouseUp}
         
        >
         
           
          
        </canvas>
        </div>
        
        </section>
    </div>
  </body>
  );
};

export default App;

