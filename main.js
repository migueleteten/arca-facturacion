// Variables globales para almacenar datos iniciales
let allProveedores = [];
let allExpedientes = [];
let allConceptos = [];
let todasLasFamilias = []; // Lista única de familias de conceptos
let selectedProviderInfo = null; // Para guardar info del proveedor
let currentNewConceptTrigger = null;
let todasLasDescripcionesProveedor = [];
let pdfFilesList = [];

/**
 * Se ejecuta cuando el contenido del DOM está completamente cargado.
 */
document.addEventListener('DOMContentLoaded', function() {
  // Cargar datos iniciales del servidor
  showSpinner(); // Mostrar un indicador de carga
  google.script.run
    .withSuccessHandler(onInitialDataSuccess)
    .withFailureHandler(onInitialDataFailure)
    .getInitialData();

  // Configurar el año actual en el footer
  document.getElementById('currentYear').textContent = new Date().getFullYear();

  // Cargar la lista inicial de PDFs pendientes
  cargarListaPdfsPendientes(''); 
  setupEventListenersPdf();
  
  // Configurar listeners de eventos básicos (más se añadirán después)
  setupEventListeners();

  // Crear la primera estructura para el concepto a nivel de factura. AQUÍ NO
  // createConceptEntry('FacturaNivel', document.getElementById('conceptoContainerFacturaNivel'));
});

/**
 * Maneja la respuesta exitosa de getInitialData.
 */
function onInitialDataSuccess(data) {
  hideSpinner();
  console.log("Datos iniciales recibidos:", data);
  if (data.error) { /* ... manejo de error ... */ return; }

  allProveedores = data.proveedores || [];
  allExpedientes = data.expedientes || [];
  allConceptos = data.conceptos || [];

  const familiasSet = new Set();
  allConceptos.forEach(c => familiasSet.add(c.familia));
  todasLasFamilias = Array.from(familiasSet).sort();
  console.log("onInitialDataSuccess: todasLasFamilias poblado con:", todasLasFamilias);

  const descripcionesSet = new Set();
  allProveedores.forEach(p => {
    if (p.descripcion && p.descripcion.trim() !== "") {
      descripcionesSet.add(p.descripcion.trim());
    }
  });
  todasLasDescripcionesProveedor = Array.from(descripcionesSet).sort();

  // AHORA creamos y poblamos la sección de concepto a nivel factura
  const containerFacturaNivel = document.getElementById('conceptoContainerFacturaNivel');
  if (containerFacturaNivel) {
      createConceptEntry('FacturaNivel', containerFacturaNivel);
      console.log("onInitialDataSuccess: Estructura de concepto para FacturaNivel creada.");
  } else {
      console.error("onInitialDataSuccess: No se encontró el contenedor 'conceptoContainerFacturaNivel'.");
  }

  populateDatalists(); // Esto ahora puede usar allProveedores y allExpedientes
  populateStaticSelects();
  actualizarComparacionNetos();
}

/**
 * Maneja el fallo de getInitialData.
 */
function onInitialDataFailure(error) {
  hideSpinner();
  alert("Error crítico al cargar datos del servidor: " + error.message);
  console.error("Error en llamada a getInitialData:", error);
}

function setupEventListenersPdf() {
  const buscarPdfInput = document.getElementById('buscarPdfFactura');
  const idPdfSeleccionadoInput = document.getElementById('idPdfSeleccionado');
  const nombreOriginalPdfInput = document.getElementById('nombreOriginalPdfSeleccionado');
  const pdfSeleccionadoInfoDiv = document.getElementById('pdfSeleccionadoInfo');
  const fechaRegContableInput = document.getElementById('fechaRegistroContable');
  const fechaRealFacturaInput = document.getElementById('fechaRealFactura');    

  if (buscarPdfInput) {
    // Podrías buscar al escribir (con debounce) o al perder el foco
    buscarPdfInput.addEventListener('input', function(event) {
      const searchTerm = event.target.value;
      // Si el usuario borra el campo y había algo seleccionado, limpiar
      if (searchTerm === "" && idPdfSeleccionadoInput.value !== "") {
          idPdfSeleccionadoInput.value = "";
          nombreOriginalPdfInput.value = "";
          if(pdfSeleccionadoInfoDiv) pdfSeleccionadoInfoDiv.textContent = "";
      }
      // Lógica para buscar y poblar datalist (ejemplo simple al escribir)
      if(searchTerm.length > 2 || searchTerm.length === 0) { // Buscar si hay más de 2 caracteres o si está vacío (para recargar todo)
          cargarListaPdfsPendientes(searchTerm);
      }
    });

    // Cuando el usuario selecciona del datalist (el valor del input cambia para coincidir)
    buscarPdfInput.addEventListener('change', function(event) { // 'change' se dispara cuando pierde foco o selecciona
        const nombreSeleccionado = event.target.value;
        const archivoEncontrado = pdfFilesList.find(f => f.nombre === nombreSeleccionado);
        
        if (archivoEncontrado) {
            idPdfSeleccionadoInput.value = archivoEncontrado.id;
            nombreOriginalPdfInput.value = archivoEncontrado.nombreOriginal;
            if(pdfSeleccionadoInfoDiv) pdfSeleccionadoInfoDiv.textContent = `Seleccionado: ${archivoEncontrado.nombre} (ID: ${archivoEncontrado.id.substring(0,10)}...)`;
            // console.log("PDF Seleccionado:", archivoEncontrado);
        } else {
            // Si el usuario escribió algo que no está en la lista, limpiar selección
            if(idPdfSeleccionadoInput.value !== "") { // Solo limpiar si había algo antes
                idPdfSeleccionadoInput.value = "";
                nombreOriginalPdfInput.value = "";
                if(pdfSeleccionadoInfoDiv) pdfSeleccionadoInfoDiv.textContent = "Ningún PDF válido seleccionado.";
            }
        }
    });
  }

  // Nos aseguramos de que ambos elementos existen antes de añadir el listener
  if (fechaRegContableInput && fechaRealFacturaInput) {
    
    // Añadimos un listener al campo "Fecha Registro Contable"
    // El evento 'change' se dispara cuando el usuario selecciona una fecha y el campo pierde el foco
    fechaRegContableInput.addEventListener('change', function() {
      
      // IMPORTANTE: Solo autorrellenamos si el campo "Fecha Factura REAL" está vacío.
      // Esto evita sobreescribir un valor que el usuario haya introducido manualmente.
      if (fechaRealFacturaInput.value === '') {
        fechaRealFacturaInput.value = this.value; // 'this.value' es el valor del campo que disparó el evento
      }
    });
  }    
}

/**
 * Función auxiliar para calcular IVA y Total en el formulario principal.
 */
function calcularValoresIVAFormulario() {
    const tipoIVASelect = document.getElementById('tipoIVA');
    // Solo calcular si no es modo manual
    if (tipoIVASelect.value !== 'manual') {
        const neto = parseFloat(document.getElementById('totalNeto').value) || 0;
        const tipoIVAPercent = parseFloat(tipoIVASelect.value) || 0;
        const cuotaIVA = (neto * tipoIVAPercent) / 100;
        const totalFactura = neto + cuotaIVA;

        document.getElementById('importeIVA').value = cuotaIVA.toFixed(2);
        document.getElementById('totalFacturaConIVA').value = totalFactura.toFixed(2);
    }
}  

function cargarListaPdfsPendientes(searchTerm) {
  // console.log("Buscando PDFs con:", searchTerm);
  // No mostrar spinner aquí para no ser intrusivo, o uno muy sutil
  google.script.run
    .withSuccessHandler(function(archivos) {
      if (archivos.error) {
        console.error("Error cargando PDFs:", archivos.error);
        // Manejar error en UI si es necesario
        return;
      }
      pdfFilesList = archivos; // Guardar la lista completa para la validación en 'change'
      const datalist = document.getElementById('pdfDatalist');
      if (datalist) {
        datalist.innerHTML = ''; // Limpiar opciones previas
        archivos.forEach(archivo => {
          const option = document.createElement('option');
          option.value = archivo.nombre; // Esto es lo que se muestra y se busca
          // Podrías añadir el ID como data-attribute si fuera necesario, pero lo obtenemos de pdfFilesList
          datalist.appendChild(option);
        });
      }
      // console.log("Datalist de PDFs actualizado con", archivos.length, "archivos.");
    })
    .withFailureHandler(function(error) {
      console.error("Fallo crítico cargando PDFs:", error);
    })
    .listarArchivosPdfNoRegistrados(searchTerm);
}

/**
 * Puebla los datalists iniciales.
 */
function populateDatalists() {
  const providerDatalist = document.getElementById('providerDatalist');
  providerDatalist.innerHTML = ''; // Limpiar opciones previas
  allProveedores.forEach(p => {
    const option = document.createElement('option');
    option.value = `${p.cif} - ${p.razonSocial || p.nombreComercial}`; // Lo que se muestra en el input al teclear
    option.dataset.cif = p.cif; // Guardamos el CIF para usarlo al seleccionar
    option.dataset.razonSocial = p.razonSocial;
    option.dataset.nombreComercial = p.nombreComercial;
    option.dataset.tipoProveedor = p.tipoProveedor;
    option.dataset.familias = JSON.stringify(p.familias); // Guardar familias como JSON string
    option.dataset.direccion = p.direccion || "";
    option.dataset.descripcionProveedor = p.descripcion || "";
    providerDatalist.appendChild(option);
  });

  const expedienteDatalistFactura = document.querySelector('#fieldsetAsignacionFactura #expedienteDatalist_FacturaNivel'); // Se creará con createConceptEntry
  if (expedienteDatalistFactura) {
      allExpedientes.forEach(e => {
          const option = document.createElement('option');
          option.value = `${e.codigo} - ${e.direccion}`;
          option.dataset.codigo = e.codigo;
          option.dataset.direccion = e.direccion;
          expedienteDatalistFactura.appendChild(option);
      });
  }

  const datalist = document.getElementById('proveedorDescripcionesDatalist');
  if (!datalist) return;
  datalist.innerHTML = ''; // Limpiar
  todasLasDescripcionesProveedor.forEach(desc => {
      const option = document.createElement('option');
      option.value = desc;
      datalist.appendChild(option);
  });
}

/**
 * Puebla selects estáticos (ej. familias en modal de nuevo proveedor).
 */
function populateStaticSelects() {
  const modalProvFamilia1 = document.getElementById('modalProvFamilia1');
  const modalProvFamilia2 = document.getElementById('modalProvFamilia2');
  const modalProvFamilia3 = document.getElementById('modalProvFamilia3');

  [modalProvFamilia1, modalProvFamilia2, modalProvFamilia3].forEach(select => {
      if (!select) return;
      select.innerHTML = '<option value="">-- Seleccionar --</option>'; // Opción por defecto
      todasLasFamilias.forEach(familia => {
          const option = document.createElement('option');
          option.value = familia;
          option.textContent = familia;
          select.appendChild(option.cloneNode(true));
      });
  });
}

/**
 * Configura los listeners de eventos principales.
 */
function setupEventListeners() {
  // Listener para el input de CIF/Nombre de Proveedor
  const cifInput = document.getElementById('cifProveedor');
  cifInput.addEventListener('input', function(event) {
      // Cuando el usuario selecciona una opción del datalist (el input event a veces se dispara)
      // o borra el campo. El 'change' event es más fiable para la selección final.
      const selectedOption = Array.from(document.getElementById('providerDatalist').options).find(opt => opt.value === event.target.value);
      if (selectedOption) {
          document.getElementById('cifProveedor').value = selectedOption.dataset.cif; // Actualizar input con solo CIF
          document.getElementById('razonSocialProveedor').value = selectedOption.dataset.razonSocial;
          document.getElementById('nombreComercialProveedor').value = selectedOption.dataset.nombreComercial;
          document.getElementById('tipoProveedorDetectado').value = selectedOption.dataset.tipoProveedor;
          
          selectedProviderInfo = { // Guardar la info
              familias: JSON.parse(selectedOption.dataset.familias || "[]"),
              tipoProveedor: selectedOption.dataset.tipoProveedor,
              descripcion: selectedOption.dataset.descripcionProveedor || ""
          };
          console.log("Selected Provider Info Stored:", selectedProviderInfo);

          // Pre-rellenar familia y tipo del concepto a nivel factura
          if (document.getElementById(`conceptoFamilia_FacturaNivel`)) {
              prefillConceptFamiliaAndTipo('FacturaNivel', selectedProviderInfo.familias, selectedProviderInfo.tipoProveedor);
          }
          document.getElementById('direccionProveedor').value = selectedOption.dataset.direccion || ""; // MOSTRAR DIRECCIÓN
          selectedProviderInfo.direccion = selectedOption.dataset.direccion || ""; // Guardar en selectedProviderInfo

      } else if (event.target.value === '') { // Si el campo se vacía
          document.getElementById('razonSocialProveedor').value = '';
          document.getElementById('nombreComercialProveedor').value = '';
          document.getElementById('tipoProveedorDetectado').value = '';
          selectedProviderInfo = null; // Limpiar info guardada
      }
  });

  // Listener para el cambio de Tipo IVA para calcular cuota
  const tipoIVASelect = document.getElementById('tipoIVA');
  const totalNetoInput = document.getElementById('totalNeto');
  tipoIVASelect.addEventListener('change', calcularIVA);
  totalNetoInput.addEventListener('input', calcularIVA);
  
  // Listener para el botón Añadir Detalle
  const addDetailBtn = document.getElementById('addDetailButton');
  addDetailBtn.addEventListener('click', addInvoiceDetailRow);

  // Listener para el formulario principal
  const invoiceForm = document.getElementById('invoiceForm');
  invoiceForm.addEventListener('submit', handleFormSubmit);

  // Listeners para modales (botones de abrir/cerrar)
  document.getElementById('btnNuevoProveedor').addEventListener('click', () => {
    document.getElementById('modalProvCIF').value = '';
    document.getElementById('modalProvRazonSocial').value = '';
    document.getElementById('modalProvRazonSocial').readOnly = false; // Que sea editable al principio
    document.getElementById('modalProvDireccion').value = '';
    document.getElementById('modalProvDireccion').readOnly = false; // Que sea editable al principio
    document.getElementById('modalProvNombreComercial').value = '';
    document.getElementById('modalProvDescripcion').value = '';
    // Resetear selects a opción por defecto
    document.getElementById('modalProvFamilia1').value = '';
    document.getElementById('modalProvFamilia2').value = '';
    document.getElementById('modalProvFamilia3').value = '';
    document.getElementById('modalProvTipoProveedor').value = '';
    openModal('newProveedorModal');
    });
  document.getElementById('saveNewConceptInModalButton').addEventListener('click', saveNewConceptFromModal);
  document.getElementById('btnBuscarCIFaxesor').addEventListener('click', handleBuscarCIFaxesor);
  // ... (otros listeners para cerrar modales)
  document.getElementById('cancelNewProveedorInModalButton').addEventListener('click', () => closeModal('newProveedorModal'));
  document.getElementById('cancelNewConceptInModalButton').addEventListener('click', () => closeModal('newConceptModal'));
  document.getElementById('confirmB_no').addEventListener('click', () => closeModal('confirmTipoBModal'));
  document.getElementById('saveAndNewButton').addEventListener('click', handleSaveAndNew);
  document.getElementById('saveNewProveedorInModalButton').addEventListener('click', saveNewProveedorFromModal);


  // Listener para cuando el TipoConcepto cambia en el concepto a nivel de factura
  // (Se añade cuando se crea la estructura del concepto)
}

function handleSaveAndNew() {
    showSpinner();

    const newConceptData = findFirstNewConcept();
    if (newConceptData) {
        if (newConceptData.error) {
            alert(`Error de validación en concepto (${newConceptData.idSuffix}): ${newConceptData.error}`);
            hideSpinner();
            return;
        }
        // console.log("handleSaveAndNew: Nuevo concepto detectado, mostrando modal:", newConceptData);
        populateAndOpenNewConceptModal(newConceptData);
        return; 
    }

    // ... (resto de la lógica de handleSaveAndNew similar a handleFormSubmit) ...
    const numeroFacturaOficial = document.getElementById('numeroFacturaOficial').value.trim();
    if (numeroFacturaOficial === '') {
        openModal('confirmTipoBModal');
        document.getElementById('confirmB_yes').onclick = function() {
            closeModal('confirmTipoBModal');
            document.body.classList.add('saving');
            const collectedData = collectAndSaveInvoiceData(true); 
            if (collectedData) {
              google.script.run
                  .withSuccessHandler(function(response) { // Envolvemos para pasar el flag esGuardarYNuevo
                      onSaveSuccess({ ...response, esGuardarYNuevo: false }); // o true según corresponda
                      document.body.classList.remove('saving');
                  })
                  .withFailureHandler(function(error) {
                      onSaveFailure(error); // onSaveFailure debería manejar hideSpinner y classList.remove
                      document.body.classList.remove('saving');
                  })
                  .saveInvoiceDataToFirebase(collectedData);
            } else {
                document.body.classList.remove('saving');
            }
        };
        if (document.getElementById('confirmTipoBModal').style.display !== 'flex') {
            hideSpinner();
        }
        return;
    }

    document.body.classList.add('saving');
    const collectedData = collectAndSaveInvoiceData(false); 
    if (collectedData) {
        google.script.run
            .withSuccessHandler(function(response) { // Envolvemos para pasar el flag esGuardarYNuevo
                onSaveSuccess({ ...response, esGuardarYNuevo: false }); // o true según corresponda
                document.body.classList.remove('saving');
            })
            .withFailureHandler(function(error) {
                onSaveFailure(error); // onSaveFailure debería manejar hideSpinner y classList.remove
                document.body.classList.remove('saving');
            })
            .saveInvoiceDataToFirebase(collectedData);
    } else {
        document.body.classList.remove('saving');
    }
}

function calcularIVA() {
    const neto = parseFloat(document.getElementById('totalNeto').value) || 0;
    const tipoIVAPercent = parseFloat(document.getElementById('tipoIVA').value) || 0;
    const cuotaIVA = (neto * tipoIVAPercent) / 100;
    const totalFactura = neto + cuotaIVA;

    document.getElementById('importeIVA').value = cuotaIVA.toFixed(2);
    document.getElementById('totalFacturaCalculado').value = totalFactura.toFixed(2);

    actualizarComparacionNetos(); // NUEVA LLAMADA
}

let detailCounter = 0; // Para IDs únicos en detalles
/**
 * Añade una nueva fila para un detalle de factura.
 */
function addInvoiceDetailRow() {
  detailCounter++;
  const container = document.getElementById('invoiceDetailsContainer');
  const detailRowWrapper = document.createElement('div');
  detailRowWrapper.classList.add('detail-row');
  detailRowWrapper.id = `detailRowWrapper_${detailCounter}`;

  const conceptFieldsContainer = document.createElement('div');
  conceptFieldsContainer.classList.add('concept-fields-container-detail');

  // 1. Crear la estructura de campos de concepto DENTRO de conceptFieldsContainer
  createConceptEntry(detailCounter, conceptFieldsContainer, true);
  console.log(`addInvoiceDetailRow (Detalle ${detailCounter}): Estructura de concepto creada dentro de conceptFieldsContainer.`);

  // Campo de Importe Neto del Detalle (crearlo aquí también)
  const importeWrapper = document.createElement('div');
  importeWrapper.classList.add('detail-importe-wrapper');
  const importeLabel = document.createElement('label');
  importeLabel.textContent = "Importe Neto Detalle:";
  importeLabel.htmlFor = `detalleImporteNeto_${detailCounter}`;
  const importeInput = document.createElement('input');
  importeInput.type = 'number';
  importeInput.id = `detalleImporteNeto_${detailCounter}`;
  importeInput.name = `detalleImporteNeto_${detailCounter}`;
  importeInput.step = '0.01';
  importeInput.placeholder = 'Importe Neto';
  importeInput.required = true;
  importeInput.addEventListener('input', updateTotalNetoDetalles);
  importeWrapper.appendChild(importeLabel);
  importeWrapper.appendChild(importeInput);

  // Botón para eliminar el detalle
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '- Eliminar Detalle';
  removeBtn.classList.add('remove-detail-btn');
  removeBtn.onclick = function() {
      container.removeChild(detailRowWrapper);
      updateTotalNetoDetalles();
      toggleAsignacionFacturaFields();
  };
  
  // Añadir los contenedores al wrapper principal del detalle
  detailRowWrapper.appendChild(conceptFieldsContainer);
  detailRowWrapper.appendChild(importeWrapper);
  detailRowWrapper.appendChild(removeBtn);

  // 2. AÑADIR EL NUEVO DETALLE COMPLETO AL DOM PRINCIPAL
  container.appendChild(detailRowWrapper);
  console.log(`addInvoiceDetailRow (Detalle ${detailCounter}): detailRowWrapper_${detailCounter} añadido al DOM.`);

  // --- AHORA los elementos existen en el DOM y podemos obtenerlos y configurarlos ---
  let familiaToPrefill = "";
  let tipoToPrefill = "";

  if (detailCounter === 1) {
    if (selectedProviderInfo && selectedProviderInfo.familias && selectedProviderInfo.familias.length > 0) {
        familiaToPrefill = selectedProviderInfo.familias[0];
    }
    if (selectedProviderInfo) {
        tipoToPrefill = selectedProviderInfo.tipoProveedor;
    }
  } else {
    const prevDetailSuffix = detailCounter - 1;
    const prevFamiliaSelect = document.getElementById(`conceptoFamilia_${prevDetailSuffix}`);
    const prevTipoSelect = document.getElementById(`conceptoTipo_${prevDetailSuffix}`);
    if (prevFamiliaSelect) familiaToPrefill = prevFamiliaSelect.value;
    if (prevTipoSelect) tipoToPrefill = prevTipoSelect.value;
  }
  console.log(`addInvoiceDetailRow (Detalle ${detailCounter}): Valores a pre-rellenar: Familia='${familiaToPrefill}', Tipo='${tipoToPrefill}'`);

  // 3. Obtener referencias a los elementos recién creados (AHORA DEBERÍAN ENCONTRARSE)
  const newFamiliaSelect = document.getElementById(`conceptoFamilia_${detailCounter}`);
  const newTipoSelect = document.getElementById(`conceptoTipo_${detailCounter}`);
  const newCamposMaterialDiv = document.getElementById(`camposMaterial_${detailCounter}`);

  if (!newFamiliaSelect || !newTipoSelect || !newCamposMaterialDiv) {
    console.error(`addInvoiceDetailRow (Detalle ${detailCounter}): ¡ERROR CRÍTICO POST-APPEND! Uno o más elementos de concepto del detalle no se encontraron. IDs buscados: conceptoFamilia_${detailCounter}, conceptoTipo_${detailCounter}, camposMaterial_${detailCounter}`);
    return; 
  }
  console.log(`addInvoiceDetailRow (Detalle ${detailCounter}): Elementos de concepto del detalle ENCONTRADOS después de append.`);

  // 4. Pre-relleno de valores
  newFamiliaSelect.value = familiaToPrefill;
  newTipoSelect.value = tipoToPrefill;
  console.log(`addInvoiceDetailRow (Detalle ${detailCounter}): Familia pre-rellenada a '${newFamiliaSelect.value}', Tipo pre-rellenado a '${newTipoSelect.value}'`);

  // 5. Actualizar visibilidad de campos de Material
  newCamposMaterialDiv.style.display = (newTipoSelect.value === 'Material') ? 'block' : 'none';
  console.log(`addInvoiceDetailRow (Detalle ${detailCounter}): Visibilidad de camposMaterialDiv ajustada a '${newCamposMaterialDiv.style.display}'`);

  // 6. Llamar directamente a las funciones de actualización de datalists
  console.log(`addInvoiceDetailRow (Detalle ${detailCounter}): Llamando a updates para datalists.`);
  updateCategoriaMaterialDatalist(detailCounter); 
  updateDescripcionDetalladaDatalist(detailCounter);
  // --- Fin Pre-relleno y actualización ---

  toggleAsignacionFacturaFields(); 
  console.log(`addInvoiceDetailRow (Detalle ${detailCounter}): Fila de detalle añadida y configurada. Llamado toggleAsignacionFacturaFields.`);
}

function toggleEdicionManualFormulario() {
  const tipoIVASelect = document.getElementById('tipoIVA');
  const importeIVAInput = document.getElementById('importeIVA');
  const totalConIVAInput = document.getElementById('totalFacturaConIVA');
  const labelsCalculado = document.querySelectorAll('.calculado-label');

  if (!tipoIVASelect || !importeIVAInput || !totalConIVAInput || !labelsCalculado) return;

  const esManual = tipoIVASelect.value === 'manual';
  importeIVAInput.readOnly = !esManual;
  totalConIVAInput.readOnly = !esManual;
  
  labelsCalculado.forEach(label => {
      label.style.display = esManual ? 'none' : 'inline';
  });

  // Si se vuelve a un modo no manual, recalcular los valores
  if (!esManual) {
      calcularValoresIVAFormulario();
  }
}

/**
 * Crea la estructura de campos para un concepto (Familia, Tipo, Categoria, Descripcion).
 * @param {string|number} idSuffix - Sufijo para IDs únicos.
 * @param {HTMLElement} parentElement - Elemento DOM donde añadir los campos.
 * @param {boolean} [isDetail=false] - Indica si es para un detalle de factura (afecta a la lógica de Expediente).
 */
function createConceptEntry(idSuffix, parentElement, isDetail = false) {
    console.log(`createConceptEntry (${idSuffix}): INICIO. Parent element:`, parentElement);
    parentElement.innerHTML = ''; // Limpiar contenido previo si es necesario

    const fieldsWrapper = document.createElement('div');
    fieldsWrapper.classList.add('concept-fields-wrapper');

    // Familia
    const familiaDiv = document.createElement('div');
    const familiaLabel = document.createElement('label');
    familiaLabel.textContent = "Familia Concepto:";
    familiaLabel.htmlFor = `conceptoFamilia_${idSuffix}`;
    const familiaSelect = document.createElement('select');
    familiaSelect.id = `conceptoFamilia_${idSuffix}`;
    familiaSelect.name = `conceptoFamilia_${idSuffix}`;
    console.log(`createConceptEntry (${idSuffix}): Creado familiaSelect con ID: ${familiaSelect.id}`);
    // Opción por defecto
    const defaultFamiliaOpt = document.createElement('option');
    defaultFamiliaOpt.value = "";
    defaultFamiliaOpt.textContent = "-- Seleccionar Familia --";
    familiaSelect.appendChild(defaultFamiliaOpt);

    // LOG: Verificar que todasLasFamilias tiene datos aquí
    console.log(`createConceptEntry (${idSuffix}): Poblando familias. Hay ${todasLasFamilias.length} familias globales.`);
    // Poblar con todasLasFamilias (y luego lógica para priorizar familias de proveedor)
    todasLasFamilias.forEach(f => {
        const option = document.createElement('option');
        option.value = f;
        option.textContent = f;
        familiaSelect.appendChild(option.cloneNode(true));
    });
    // TODO: Añadir opción "+ Ver Todas" si es necesario y lógica de filtrado
    familiaDiv.appendChild(familiaLabel);
    familiaDiv.appendChild(familiaSelect);
    fieldsWrapper.appendChild(familiaDiv);

    // Tipo Concepto
    const tipoDiv = document.createElement('div');
    const tipoLabel = document.createElement('label');
    tipoLabel.textContent = "Tipo Concepto:";
    tipoLabel.htmlFor = `conceptoTipo_${idSuffix}`;
    const tipoSelect = document.createElement('select');
    tipoSelect.id = `conceptoTipo_${idSuffix}`;
    tipoSelect.name = `conceptoTipo_${idSuffix}`;
    console.log(`createConceptEntry (${idSuffix}): Creado tipoSelect con ID: ${tipoSelect.id}`);
    ['', 'Material', 'Mano de Obra', 'General'].forEach(t => {
        const option = document.createElement('option');
        option.value = t;
        option.textContent = t || "-- Seleccionar Tipo --";
        tipoSelect.appendChild(option);
    });
    tipoDiv.appendChild(tipoLabel);
    tipoDiv.appendChild(tipoSelect);
    fieldsWrapper.appendChild(tipoDiv);

    // Contenedor para campos de Material (Categoría)
    const camposMaterialDiv = document.createElement('div');
    camposMaterialDiv.id = `camposMaterial_${idSuffix}`;
    console.log(`createConceptEntry (${idSuffix}): Creado camposMaterialDiv con ID: ${camposMaterialDiv.id}`);
    camposMaterialDiv.style.display = 'none'; // Oculto por defecto

    const categoriaLabel = document.createElement('label');
    categoriaLabel.textContent = "Categoría (Material):";
    categoriaLabel.htmlFor = `conceptoCategoriaMaterial_${idSuffix}`;
    const categoriaInput = document.createElement('input');
    categoriaInput.type = 'text';
    categoriaInput.id = `conceptoCategoriaMaterial_${idSuffix}`;
    categoriaInput.name = `conceptoCategoriaMaterial_${idSuffix}`;
    categoriaInput.setAttribute('list', `categoriaMaterialDatalist_${idSuffix}`);
    const categoriaDatalist = document.createElement('datalist');
    categoriaDatalist.id = `categoriaMaterialDatalist_${idSuffix}`;
    camposMaterialDiv.appendChild(categoriaLabel);
    camposMaterialDiv.appendChild(categoriaInput);
    camposMaterialDiv.appendChild(categoriaDatalist);
    fieldsWrapper.appendChild(camposMaterialDiv);
    
    // Descripción Detallada Concepto
    const descDiv = document.createElement('div');
    const descLabel = document.createElement('label');
    descLabel.textContent = "Descripción Detallada Concepto:";
    descLabel.htmlFor = `conceptoDescripcionDetallada_${idSuffix}`;
    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.id = `conceptoDescripcionDetallada_${idSuffix}`;
    descInput.name = `conceptoDescripcionDetallada_${idSuffix}`;
    descInput.setAttribute('list', `descripcionDetalladaDatalist_${idSuffix}`);
    const descDatalist = document.createElement('datalist');
    descDatalist.id = `descripcionDetalladaDatalist_${idSuffix}`;
    descDiv.appendChild(descLabel);
    descDiv.appendChild(descInput);
    descDiv.appendChild(descDatalist);
    fieldsWrapper.appendChild(descDiv);

    // Listener para el cambio de TipoConcepto para mostrar/ocultar campos de material
    tipoSelect.addEventListener('change', function() {
        camposMaterialDiv.style.display = (this.value === 'Material') ? 'block' : 'none';
        // Aquí también se debería actualizar el datalist de Descripción Detallada
        updateDescripcionDetalladaDatalist(idSuffix);
    });
    familiaSelect.addEventListener('change', function() {
         updateCategoriaMaterialDatalist(idSuffix); // Categoria depende de Familia y Tipo
         updateDescripcionDetalladaDatalist(idSuffix); // Descripcion depende de Familia, Tipo y Categoria
    });
    categoriaInput.addEventListener('input', function() { // O 'change'
        updateDescripcionDetalladaDatalist(idSuffix); // Descripcion depende de Categoria
    });


    // Campos de Asignación (Sede, Expediente, Dirección)
    // Sede
    const sedeDiv = document.createElement('div');
    const sedeLabel = document.createElement('label');
    sedeLabel.textContent = "Sede:";
    sedeLabel.htmlFor = `conceptoSede_${idSuffix}`;
    const sedeSelect = document.createElement('select');
    sedeSelect.id = `conceptoSede_${idSuffix}`;
    sedeSelect.name = `conceptoSede_${idSuffix}`;
    // Opciones de Sede (puedes obtenerlas de una constante o GSheet si cambian mucho)
    ['', 'VA', 'PA', 'BU', 'LE', 'AR', 'IN', 'DI'].forEach(s => {
        const option = document.createElement('option');
        option.value = s;
        option.textContent = s || "-- Seleccionar Sede --";
        sedeSelect.appendChild(option);
    });
    if (isDetail) sedeSelect.required = true; // Obligatorio para detalles
    sedeDiv.appendChild(sedeLabel);
    sedeDiv.appendChild(sedeSelect);
    fieldsWrapper.appendChild(sedeDiv);

    // Expediente
    const expDiv = document.createElement('div');
    const expLabel = document.createElement('label');
    expLabel.textContent = "Expediente (Código o Dirección):";
    expLabel.htmlFor = `conceptoExpedienteInput_${idSuffix}`;
    const expInput = document.createElement('input');
    expInput.type = 'text';
    expInput.id = `conceptoExpedienteInput_${idSuffix}`;
    expInput.name = `conceptoExpedienteInput_${idSuffix}`;
    expInput.setAttribute('list', `expedienteDatalist_${idSuffix}`);
    const expDatalist = document.createElement('datalist');
    expDatalist.id = `expedienteDatalist_${idSuffix}`;
    allExpedientes.forEach(e => { // Poblar datalist de expedientes
          const option = document.createElement('option');
          option.value = `${e.codigo} - ${e.direccion}`;
          option.dataset.codigo = e.codigo;
          option.dataset.direccion = e.direccion;
          expDatalist.appendChild(option);
      });
    if (isDetail) expInput.required = false; // Obligatorio para detalles
    expDiv.appendChild(expLabel);
    expDiv.appendChild(expInput);
    expDiv.appendChild(expDatalist);
    fieldsWrapper.appendChild(expDiv);
    
    // Dirección Expediente (readonly)
    const dirDiv = document.createElement('div');
    const dirLabel = document.createElement('label');
    dirLabel.textContent = "Dirección Expediente:";
    dirLabel.htmlFor = `conceptoDireccion_${idSuffix}`;
    const dirInput = document.createElement('input');
    dirInput.type = 'text';
    dirInput.id = `conceptoDireccion_${idSuffix}`;
    dirInput.name = `conceptoDireccion_${idSuffix}`;
    dirInput.readOnly = true;
    dirDiv.appendChild(dirLabel);
    dirDiv.appendChild(dirInput);
    fieldsWrapper.appendChild(dirDiv);

    // Listener para autocompletar dirección de expediente
    expInput.addEventListener('input', function(event) {
        const selectedOption = Array.from(expDatalist.options).find(opt => opt.value === event.target.value);
        if (selectedOption) {
            dirInput.value = selectedOption.dataset.direccion;
            // Opcionalmente, actualizar el valor del input a solo el código
            // event.target.value = selectedOption.dataset.codigo; 
        } else if (event.target.value === '') {
            dirInput.value = '';
        }
    });

    parentElement.appendChild(fieldsWrapper);
    console.log(`createConceptEntry (${idSuffix}): FINAL. fieldsWrapper añadido al parentElement.`);
}

// NUEVA función para buscar CIF en Axesor
function handleBuscarCIFaxesor() {
    const cif = document.getElementById('modalProvCIF').value.trim().toUpperCase();
    if (!cif) {
        alert("Por favor, introduzca un CIF para buscar.");
        return;
    }
    // console.log("Buscando CIF en Axesor:", cif);
    showSpinner(); // Mostrar spinner durante la búsqueda
    google.script.run
        .withSuccessHandler(onAxesorDataFetched)
        .withFailureHandler(onAxesorDataFetchFailure)
        .fetchAxesorDataByCif(cif);
}

// NUEVA función callback para cuando Axesor devuelve datos
function onAxesorDataFetched(response) {
    hideSpinner();
    // console.log("Respuesta de fetchAxesorDataByCif:", response);
    const razonSocialInput = document.getElementById('modalProvRazonSocial');
    const direccionInput = document.getElementById('modalProvDireccion');

    if (response.success && response.axesorData) {
        const data = response.axesorData;
        razonSocialInput.value = data.razonSocial || '';
        direccionInput.value = data.direccion || '';
        // telefonoInput si lo tuvieras: document.getElementById('modalProvTelefono').value = data.telefono || '';
        
        if (data.razonSocial) razonSocialInput.readOnly = true; // Si Axesor da Razón Social, bloquearla
        else razonSocialInput.readOnly = false;

        if (data.direccion) direccionInput.readOnly = true; // Si Axesor da Dirección, bloquearla
        else direccionInput.readOnly = false;

        alert("Datos de Axesor cargados. Por favor, revise y complete el resto de campos.");
    } else {
        alert(response.message || "No se pudo obtener información de Axesor. Por favor, introduzca los datos manualmente.");
        razonSocialInput.value = ''; // Limpiar por si había algo
        direccionInput.value = '';
        razonSocialInput.readOnly = false; // Permitir edición manual
        direccionInput.readOnly = false;   // Permitir edición manual
        razonSocialInput.focus();
    }
}

// NUEVA función callback para fallo en la llamada a Axesor
function onAxesorDataFetchFailure(error) {
    hideSpinner();
    alert("Error de comunicación al buscar CIF en Axesor: " + error.message + ". Por favor, introduzca los datos manualmente.");
    document.getElementById('modalProvRazonSocial').readOnly = false;
    document.getElementById('modalProvDireccion').readOnly = false;
}  

function saveNewProveedorFromModal() {
    const cif = document.getElementById('modalProvCIF').value.trim().toUpperCase();
    const razonSocial = document.getElementById('modalProvRazonSocial').value.trim(); // Ahora puede ser de Axesor o manual
    const direccion = document.getElementById('modalProvDireccion').value.trim();     // Ahora puede ser de Axesor o manual
    const nombreComercial = document.getElementById('modalProvNombreComercial').value.trim();
    const descripcionProveedor = document.getElementById('modalProvDescripcion').value.trim();
    const familia1 = document.getElementById('modalProvFamilia1').value;
    const familia2 = document.getElementById('modalProvFamilia2').value;
    const familia3 = document.getElementById('modalProvFamilia3').value;
    const tipoProveedor = document.getElementById('modalProvTipoProveedor').value;

    if (!cif || !razonSocial) { // Razón social ahora es obligatoria en el modal (sea de Axesor o manual)
        alert("El CIF y la Razón Social son obligatorios.");
        return;
    }
    // La dirección podría ser opcional si así lo decides, o requerirla aquí.
    if (!direccion) {
        alert("La Dirección es obligatoria.");
         return;
    }

    const familias = [familia1, familia2, familia3].filter(f => f && f.trim() !== "");
    if (familias.length === 0) {
        alert("Debe seleccionar al menos una Familia para el proveedor.");
        return;
    }
    if (!tipoProveedor) {
        alert("Debe seleccionar un Tipo de Proveedor.");
        return;
    }

    const proveedorDataParaGuardar = {
        cif: cif,
        razonSocial: razonSocial,
        direccion: direccion,
        nombreComercial: nombreComercial,
        descripcion: descripcionProveedor,
        familias: familias,
        tipoProveedor: tipoProveedor,
        telefono: "" // Podríamos añadir campo teléfono al modal si Axesor lo devuelve
    };

    // console.log("Enviando para guardar proveedor en GSheet:", proveedorDataParaGuardar);
    showSpinner();
    // Llamamos a la nueva función de servidor que solo guarda en la hoja
    google.script.run
        .withSuccessHandler(onNewProveedorSaveSuccess) // onNewProveedorSaveSuccess ya existe y debería funcionar bien
        .withFailureHandler(onNewProveedorSaveFailure) // onNewProveedorSaveFailure ya existe
        .addProveedorToSheet(proveedorDataParaGuardar); // Llamada a la función de servidor MODIFICADA
}

function onNewProveedorSaveSuccess(response) {
    hideSpinner();
    if (response.success && response.proveedor) {
        const nuevoProv = response.proveedor;
        alert(response.message || "Proveedor guardado con éxito.");

        // 1. Añadir a allProveedores (o recargar todos si es más fácil, pero añadir es más eficiente)
        allProveedores.push({
            cif: nuevoProv.cif,
            razonSocial: nuevoProv.razonSocial,
            nombreComercial: nuevoProv.nombreComercial,
            familias: nuevoProv.familias, // Ya es un array desde el servidor
            tipoProveedor: nuevoProv.tipoProveedor,
            direccion: nuevoProv.direccion, // Añadir dirección a la estructura cliente
            telefono: nuevoProv.telefono   // Añadir teléfono
        });

        // 2. Re-poblar datalist de proveedores
        populateDatalists(); // Esta función ya limpia y repuebla providerDatalist

        // 3. Opcional: Seleccionar automáticamente el nuevo proveedor en el formulario principal
        document.getElementById('cifProveedor').value = nuevoProv.cif;
        document.getElementById('razonSocialProveedor').value = nuevoProv.razonSocial;
        document.getElementById('nombreComercialProveedor').value = nuevoProv.nombreComercial;
        document.getElementById('direccionProveedor').value = nuevoProv.direccion || ""; // Mostrar dirección
        document.getElementById('tipoProveedorDetectado').value = nuevoProv.tipoProveedor;
        
        selectedProviderInfo = { // Actualizar info global del proveedor seleccionado
            familias: nuevoProv.familias,
            tipoProveedor: nuevoProv.tipoProveedor,
            direccion: nuevoProv.direccion,
            telefono: nuevoProv.telefono
        };
        if (document.getElementById(`conceptoFamilia_FacturaNivel`)) {
            prefillConceptFamiliaAndTipo('FacturaNivel', selectedProviderInfo.familias, selectedProviderInfo.tipoProveedor);
        }
        
        closeModal('newProveedorModal');
        // Limpiar campos del modal de nuevo proveedor para la próxima vez
        document.getElementById('modalProvCIF').value = '';
        document.getElementById('modalProvRazonSocial').value = '';
        document.getElementById('modalProvDireccion').value = '';
        document.getElementById('modalProvNombreComercial').value = '';
        // ... resetear selects del modal ...

    } else {
        alert("Error al guardar proveedor: " + (response.message || "Error desconocido del servidor."));
        // Si response.proveedorConDatosAxesor existe, significa que Axesor funcionó pero GSheet falló
        if (response.proveedorConDatosAxesor) {
            document.getElementById('modalProvRazonSocial').value = response.proveedorConDatosAxesor.razonSocial;
            document.getElementById('modalProvDireccion').value = response.proveedorConDatosAxesor.direccion;
            alert("Se obtuvieron datos de Axesor pero hubo un error guardando en la hoja. Revisa los campos y vuelve a intentar.");
        }
    }
}

function onNewProveedorSaveFailure(error) {
    hideSpinner();
    alert("Error crítico al comunicar con el servidor para guardar proveedor: " + error.message);
}  

function saveNewConceptFromModal() {
    if (!currentNewConceptTrigger) {
        console.error("Error: currentNewConceptTrigger no está definido al intentar guardar desde modal.");
        closeModal('newConceptModal');
        return;
    }

    const newConceptToSave = {
        familia: document.getElementById('modalConceptoFamilia').value,
        tipoConcepto: document.getElementById('modalConceptoTipo').value,
        categoriaMaterial: '',
        descripcionDetallada: document.getElementById('modalConceptoDescripcionDetallada').value.trim()
    };

    if (newConceptToSave.tipoConcepto === 'Material') {
        newConceptToSave.categoriaMaterial = document.getElementById('modalConceptoCategoriaMaterial').value.trim();
        if (!newConceptToSave.categoriaMaterial) {
            alert("La Categoría es obligatoria para conceptos de tipo Material.");
            return;
        }
    }
    if (!newConceptToSave.descripcionDetallada && newConceptToSave.tipoConcepto !== 'Material' && !currentNewConceptTrigger.isCategoriaNew) {
      // Para MO/General, o si solo la descripción de Material es nueva, la descripción es necesaria.
      // Si es una categoría nueva de Material, la descripción puede ser opcional inicialmente (el usuario la puede completar luego).
      // Ajusta esta lógica si la descripción detallada siempre es obligatoria al crear un nuevo concepto.
    }


    // console.log("Guardando nuevo concepto desde modal:", newConceptToSave);
    showSpinner(); // Mostrar spinner para la operación de guardado del concepto

    google.script.run
        .withSuccessHandler(function(response) {
            onNewConceptSaveSuccess(response, newConceptToSave, currentNewConceptTrigger.idSuffix);
        })
        .withFailureHandler(onNewConceptSaveFailure)
        .addNewConceptToSheet(newConceptToSave); // Esta es tu función en Code.gs
}

function onNewConceptSaveSuccess(response, savedConceptData, originalIdSuffix) {
    hideSpinner();
    // console.log("Respuesta de addNewConceptToSheet:", response);
    if (response && response.success) {
        alert("Nuevo concepto guardado con éxito en la hoja de cálculo.");
        
        // 1. Añadir el concepto nuevo a allConceptos en el cliente
        allConceptos.push(savedConceptData);
        // console.log("allConceptos actualizado con:", savedConceptData);

        // 2. Opcional: Re-poblar datalists relevantes o actualizar el input original
        // Esto puede ser complejo. Una forma simple es forzar la actualización de los datalists
        // del campo que originó el modal.
        const familiaOriginal = document.getElementById(`conceptoFamilia_${originalIdSuffix}`);
        const tipoOriginal = document.getElementById(`conceptoTipo_${originalIdSuffix}`);
        const categoriaOriginal = document.getElementById(`conceptoCategoriaMaterial_${originalIdSuffix}`);
        
        if (tipoOriginal.value === 'Material') {
            if (categoriaOriginal) categoriaOriginal.value = savedConceptData.categoriaMaterial; // Actualizar input
            updateCategoriaMaterialDatalist(originalIdSuffix); // Actualizar su datalist
        }
        const descripcionOriginal = document.getElementById(`conceptoDescripcionDetallada_${originalIdSuffix}`);
        if (descripcionOriginal) descripcionOriginal.value = savedConceptData.descripcionDetallada; // Actualizar input
        updateDescripcionDetalladaDatalist(originalIdSuffix); // Actualizar su datalist


        closeModal('newConceptModal');
        currentNewConceptTrigger = null;
        alert("Concepto añadido. Por favor, intente guardar la factura de nuevo.");
    } else {
        alert("Error al guardar el nuevo concepto en la hoja: " + (response ? response.message : "Error desconocido."));
    }
}

function onNewConceptSaveFailure(error) {
    hideSpinner();
    alert("Error crítico al guardar el nuevo concepto: " + error.message);
    closeModal('newConceptModal');
    currentNewConceptTrigger = null;
}  

function prefillConceptFamiliaAndTipo(idSuffix, proveedorFamilias, proveedorTipo) {
  const familiaSelect = document.getElementById(`conceptoFamilia_${idSuffix}`);
  const tipoSelect = document.getElementById(`conceptoTipo_${idSuffix}`);
  const camposMaterialDiv = document.getElementById(`camposMaterial_${idSuffix}`); // Necesitamos este div

  console.log(`prefill (${idSuffix}): INICIO. Familias Prov:`, proveedorFamilias, "Tipo Prov:", proveedorTipo);

  let familiaPreseleccionada = "";
  let tipoPreseleccionado = "";

  if (familiaSelect) {
      if (proveedorFamilias && proveedorFamilias.length > 0) {
          familiaSelect.value = proveedorFamilias[0];
          familiaPreseleccionada = familiaSelect.value;
          console.log(`prefill (${idSuffix}): Familia ${familiaSelect.id} valor establecido a: ${familiaPreseleccionada}`);
      } else {
          familiaSelect.value = "";
      }
  }

  if (tipoSelect) {
      tipoSelect.value = proveedorTipo || "";
      tipoPreseleccionado = tipoSelect.value;
      console.log(`prefill (${idSuffix}): Tipo ${tipoSelect.id} valor establecido a: ${tipoPreseleccionado}`);
  }

  // 1. Actualizar visibilidad de campos de Material (como lo haría el listener de tipoSelect)
  if (camposMaterialDiv) {
      camposMaterialDiv.style.display = (tipoPreseleccionado === 'Material') ? 'block' : 'none';
      console.log(`prefill (${idSuffix}): Visibilidad de camposMaterialDiv ajustada a '${camposMaterialDiv.style.display}' basado en Tipo='${tipoPreseleccionado}'`);
  }

  // 2. Llamar directamente a las funciones de actualización de datalists
  //    Estas funciones ya leen los valores actuales de los selects de familia y tipo.
  console.log(`prefill (${idSuffix}): Llamando directamente a updateCategoriaMaterialDatalist y updateDescripcionDetalladaDatalist.`);
  updateCategoriaMaterialDatalist(idSuffix);
  updateDescripcionDetalladaDatalist(idSuffix); // Esta se autoprotege si categoría no está lista
}

function updateCategoriaMaterialDatalist(idSuffix) {
  const familia = document.getElementById(`conceptoFamilia_${idSuffix}`).value;
  const tipo = document.getElementById(`conceptoTipo_${idSuffix}`).value;
  const datalist = document.getElementById(`categoriaMaterialDatalist_${idSuffix}`);

  console.log(`updateCategoria (${idSuffix}): Familia=${familia}, Tipo=${tipo}`);

  if (!datalist) {
    console.error(`updateCategoria (${idSuffix}): Datalist 'categoriaMaterialDatalist_${idSuffix}' no encontrado.`);
    return;
  }
  datalist.innerHTML = '';

  if (tipo === 'Material' && familia) {
      const categoriasUnicas = new Set();
      console.log(`updateCategoria (${idSuffix}): Filtrando allConceptos (${allConceptos.length}) por Familia=${familia}, Tipo=Material`);
      const conceptosFiltrados = allConceptos.filter(c => c.familia === familia && c.tipoConcepto === 'Material' && c.categoriaMaterial);
      console.log(`updateCategoria (${idSuffix}): Conceptos filtrados para categoría:`, conceptosFiltrados);

      conceptosFiltrados.forEach(c => categoriasUnicas.add(c.categoriaMaterial));
      
      console.log(`updateCategoria (${idSuffix}): Categorías únicas encontradas:`, Array.from(categoriasUnicas));
      categoriasUnicas.forEach(cat => {
          const option = document.createElement('option');
          option.value = cat;
          datalist.appendChild(option);
      });
  }
}

function updateDescripcionDetalladaDatalist(idSuffix) {
  const familia = document.getElementById(`conceptoFamilia_${idSuffix}`).value;
  const tipo = document.getElementById(`conceptoTipo_${idSuffix}`).value;
  const categoriaInput = document.getElementById(`conceptoCategoriaMaterial_${idSuffix}`); // El input, no el datalist
  const categoria = (tipo === 'Material' && categoriaInput) ? categoriaInput.value : null; // Usar .value del input
  const datalist = document.getElementById(`descripcionDetalladaDatalist_${idSuffix}`);

  console.log(`updateDescripcion (${idSuffix}): Familia=${familia}, Tipo=${tipo}, Categoria=${categoria}`);

  if (!datalist) {
    console.error(`updateDescripcion (${idSuffix}): Datalist 'descripcionDetalladaDatalist_${idSuffix}' no encontrado.`);
    return;
  }
  datalist.innerHTML = '';

  if (!familia || !tipo) return; // Necesitamos al menos familia y tipo
  if (tipo === 'Material' && !categoria) return;

  console.log(`updateDescripcion (${idSuffix}): Filtrando allConceptos (${allConceptos.length})`);
  const conceptosFiltrados = allConceptos.filter(c => {
      let match = c.familia === familia && c.tipoConcepto === tipo;
      if (tipo === 'Material') {
          match = match && c.categoriaMaterial === categoria;
      }
      return match && c.descripcionDetallada;
  });
  console.log(`updateDescripcion (${idSuffix}): Conceptos filtrados para descripción:`, conceptosFiltrados);

  conceptosFiltrados.forEach(c => {
      const option = document.createElement('option');
      option.value = c.descripcionDetallada;
      datalist.appendChild(option);
  });
}

function toggleAsignacionFacturaFields() {
  const detailsContainer = document.getElementById('invoiceDetailsContainer');
  const asignacionFacturaFieldset = document.getElementById('fieldsetAsignacionFactura');

  if (!asignacionFacturaFieldset) {
      console.error("toggleAsignacionFacturaFields: No se encontró 'fieldsetAsignacionFactura'.");
      return;
  }

  const hayDetalles = detailsContainer.children.length > 0;
  console.log(`toggleAsignacionFacturaFields: Hay ${detailsContainer.children.length} detalles. ¿Ocultar fieldset? ${hayDetalles}`);
  
  if (hayDetalles) {
      asignacionFacturaFieldset.style.display = 'none';
  } else {
      asignacionFacturaFieldset.style.display = 'block';
  }
}

function updateTotalNetoDetalles() {
      let total = 0;
      const detalles = document.querySelectorAll('.detail-row input[name^="detalleImporteNeto_"]'); // Ajustado el selector al wrapper
      detalles.forEach(input => {
          total += parseFloat(input.value) || 0;
      });
      document.getElementById('sumaDetallesNeto').value = total.toFixed(2);
      actualizarComparacionNetos(); // NUEVA LLAMADA
  }

  function actualizarComparacionNetos() {
    const netoCabecera = parseFloat(document.getElementById('totalNeto').value) || 0;
    const sumaDetalles = parseFloat(document.getElementById('sumaDetallesNeto').value) || 0;
    const diferencia = netoCabecera - sumaDetalles;

    const campoNetoCabeceraCopia = document.getElementById('totalNetoFacturaCabeceraCopia');
    const campoDiferenciaNetos = document.getElementById('diferenciaNetos');

    if (campoNetoCabeceraCopia) {
        campoNetoCabeceraCopia.value = netoCabecera.toFixed(2);
    }

    if (campoDiferenciaNetos) {
        campoDiferenciaNetos.value = diferencia.toFixed(2);
        if (Math.abs(diferencia) < 0.005) { // Considerar iguales si la diferencia es muy pequeña (redondeo)
            campoDiferenciaNetos.style.color = 'green';
        } else {
            campoDiferenciaNetos.style.color = 'red';
        }
    }
}

function handleFormSubmit(event) {
    event.preventDefault();
    // NO llamamos a showSpinner() aquí todavía

    // PASO 1: Verificar si hay conceptos nuevos
    const newConceptData = findFirstNewConcept();
    if (newConceptData) {
        if (newConceptData.error) { // Si es un error de validación como categoría vacía
            alert(`Error de validación en concepto (${newConceptData.idSuffix}): ${newConceptData.error}`);
            // No mostramos spinner aquí porque el error es inmediato y local
            return;
        }
        // console.log("handleFormSubmit: Nuevo concepto detectado, mostrando modal:", newConceptData);
        populateAndOpenNewConceptModal(newConceptData); // Esta función podría llamar a hideSpinner() si el spinner general estuviera activo
                                                        // pero como no lo está, no hay problema.
        return; // Detener el guardado de la factura, esperar acción del modal de nuevo concepto
    }

    // PASO 2: Si no hay conceptos nuevos, verificar si es factura Tipo B
    const numeroFacturaOficial = document.getElementById('numeroFacturaOficial').value.trim();
    if (numeroFacturaOficial === '') {
        // Es Tipo B, mostrar modal de confirmación SIN spinner aún
        openModal('confirmTipoBModal');
        
        document.getElementById('confirmB_yes').onclick = function() {
            closeModal('confirmTipoBModal');
            showSpinner(); // <-- SPINNER AQUÍ, justo antes de la "operación de guardado"
            document.body.classList.add('saving'); 

            const collectedData = collectAndSaveInvoiceData(true); // true para esTipoB
            if (collectedData) {
              google.script.run
                  .withSuccessHandler(function(response) { // Envolvemos para pasar el flag esGuardarYNuevo
                      onSaveSuccess({ ...response, esGuardarYNuevo: false }); // o true según corresponda
                      document.body.classList.remove('saving');
                  })
                  .withFailureHandler(function(error) {
                      onSaveFailure(error); // onSaveFailure debería manejar hideSpinner y classList.remove
                      document.body.classList.remove('saving');
                  })
                  .saveInvoiceDataToFirebase(collectedData);
            } else {
                // collectAndSaveInvoiceData ya llamó a hideSpinner() si hubo error de validación de sumas
                document.body.classList.remove('saving');
                // console.log("handleFormSubmit (Tipo B): Validación de datos de factura falló.");
            }
        };
        // No necesitamos 'return' aquí si el onclick es la única acción para este camino.
        // Si el usuario cierra el modal sin pulsar 'Sí', no se hace nada. El spinner no se mostró.
        return; // Importante para no seguir con el código de abajo si se muestra el modal
    }
    
    // PASO 3: Si no hay conceptos nuevos Y NO es Tipo B (es una factura normal con Nº Oficial)
    // Proceder con el guardado normal. AHORA SÍ mostramos el spinner.
    showSpinner(); // <-- SPINNER AQUÍ
    document.body.classList.add('saving');

    const collectedData = collectAndSaveInvoiceData(false); // false para esTipoB
    if (collectedData) {
        // console.log("Datos listos para enviar a Firebase:", collectedData);
        // Llamada REAL a Firebase:
        google.script.run
            .withSuccessHandler(function(response) { // Envolvemos para pasar el flag esGuardarYNuevo
                onSaveSuccess({ ...response, esGuardarYNuevo: false }); // o true según corresponda
                document.body.classList.remove('saving');
            })
            .withFailureHandler(function(error) {
                onSaveFailure(error); // onSaveFailure debería manejar hideSpinner y classList.remove
                document.body.classList.remove('saving');
            })
            .saveInvoiceDataToFirebase(collectedData);
    } else {
        // collectAndSaveInvoiceData ya mostró alert y hideSpinner
        document.body.classList.remove('saving');
        // console.log("Validación de datos de factura falló, no se llama a Firebase.");
    }
}

/**
 * Verifica si hay conceptos nuevos introducidos en el formulario.
 * Devuelve el primer concepto nuevo encontrado o null si todos son existentes.
 */
function findFirstNewConcept() {
  let newConceptFound = null;

  function checkSingleConceptEntry(idSuffix) {
    const familia = document.getElementById(`conceptoFamilia_${idSuffix}`)?.value;
    const tipo = document.getElementById(`conceptoTipo_${idSuffix}`)?.value;
    const categoriaInput = document.getElementById(`conceptoCategoriaMaterial_${idSuffix}`);
    const descripcionInput = document.getElementById(`conceptoDescripcionDetallada_${idSuffix}`);

    if (!familia || !tipo) return null; // Necesita familia y tipo para validar

    let enteredCategoria = null;
    let categoriaEsNueva = false;

    if (tipo === 'Material') {
      if (!categoriaInput || !categoriaInput.value.trim()) {
        // console.log(`checkSingleConceptEntry (${idSuffix}): Categoría es obligatoria para Tipo Material y está vacía.`);
        // Podrías querer marcar esto como un error de validación diferente.
        // Por ahora, si está vacío, no lo consideramos "nuevo concepto a crear" sino un campo faltante.
        return { error: "Categoría es obligatoria para Material.", idSuffix: idSuffix, field: 'categoria' };
      }
      enteredCategoria = categoriaInput.value.trim();
      const categoriaExiste = allConceptos.some(c =>
        c.familia === familia &&
        c.tipoConcepto === tipo &&
        c.categoriaMaterial === enteredCategoria
      );
      if (!categoriaExiste) {
        categoriaEsNueva = true;
        // console.log(`checkSingleConceptEntry (${idSuffix}): Nueva Categoría detectada: '${enteredCategoria}' para Familia '${familia}', Tipo '${tipo}'`);
        // Devolvemos la nueva categoría primero
        return {
          idSuffix: idSuffix,
          familia: familia,
          tipoConcepto: tipo,
          enteredCategoria: enteredCategoria,
          isCategoriaNew: true,
          enteredDescripcion: descripcionInput?.value.trim() || '' // Incluir descripción si el usuario ya la puso
        };
      }
    }

    // Si llegamos aquí, la categoría (si aplica) existe o no es tipo Material.
    // Ahora revisamos la descripción detallada.
    if (descripcionInput && descripcionInput.value.trim()) {
      const enteredDescripcion = descripcionInput.value.trim();
      const descripcionExiste = allConceptos.some(c =>
        c.familia === familia &&
        c.tipoConcepto === tipo &&
        (tipo === 'Material' ? c.categoriaMaterial === enteredCategoria : true) && // Compara categoría si es Material
        c.descripcionDetallada === enteredDescripcion
      );

      if (!descripcionExiste) {
        // console.log(`checkSingleConceptEntry (${idSuffix}): Nueva Descripción Detallada detectada: '${enteredDescripcion}' para Familia '${familia}', Tipo '${tipo}', Categoría '${enteredCategoria || ''}'`);
        return {
          idSuffix: idSuffix,
          familia: familia,
          tipoConcepto: tipo,
          enteredCategoria: enteredCategoria || '', // Puede ser null si no es Material
          isCategoriaNew: false, // La categoría ya existía o no aplica
          enteredDescripcion: enteredDescripcion,
          isDescripcionNew: true
        };
      }
    }
    return null; // No se encontró nada nuevo en esta entrada de concepto
  }

  // Verificar concepto a nivel de factura (si está visible)
  const fieldsetAsignacionFactura = document.getElementById('fieldsetAsignacionFactura');
  if (fieldsetAsignacionFactura && fieldsetAsignacionFactura.style.display !== 'none') {
    newConceptFound = checkSingleConceptEntry('FacturaNivel');
    if (newConceptFound) return newConceptFound; // Devolver el primero encontrado
  }

  // Verificar conceptos en detalles de factura
  const detailRows = document.querySelectorAll('.detail-row'); // O '.detail-row-wrapper' si cambiaste
  for (let i = 0; i < detailRows.length; i++) {
    const row = detailRows[i];
    const detailIdSuffix = row.id.split('_')[1]; // Asumiendo que el ID es como 'detailRow_1'
                                                // o 'detailRowWrapper_1'
    if (detailIdSuffix) {
      newConceptFound = checkSingleConceptEntry(detailIdSuffix);
      if (newConceptFound) return newConceptFound; // Devolver el primero encontrado
    }
  }

  return null; // No se encontraron conceptos nuevos
}

function populateAndOpenNewConceptModal(newConceptData) {
    console.log("populateAndOpenNewConceptModal: Recibido ", newConceptData);
    currentNewConceptTrigger = newConceptData; // Guardar para usar al guardar el concepto

    document.getElementById('modalConceptoFamilia').value = newConceptData.familia;
    document.getElementById('modalConceptoTipo').value = newConceptData.tipoConcepto;

    const modalCamposMaterialDiv = document.getElementById('modalCamposMaterial');
    const modalCategoriaInput = document.getElementById('modalConceptoCategoriaMaterial');
    const modalDescripcionInput = document.getElementById('modalConceptoDescripcionDetallada');

    if (newConceptData.tipoConcepto === 'Material') {
        modalCamposMaterialDiv.style.display = 'block';
        modalCategoriaInput.value = newConceptData.enteredCategoria || '';
        // Si la categoría es nueva, la descripción también se considera parte de este nuevo concepto.
        // Si solo la descripción es nueva (categoría ya existía), también se pone.
        modalDescripcionInput.value = newConceptData.enteredDescripcion || '';
    } else { // Mano de Obra o General
        modalCamposMaterialDiv.style.display = 'none';
        modalCategoriaInput.value = ''; // Limpiar por si acaso
        modalDescripcionInput.value = newConceptData.enteredDescripcion || ''; // Aquí solo puede ser nueva la descripción
    }
    
    hideSpinner(); // Ocultar spinner general si estaba activo
    openModal('newConceptModal');
}

function collectAndSaveInvoiceData(esTipoB) {
    const formData = new FormData(document.getElementById('invoiceForm'));
    const invoiceData = Object.fromEntries(formData.entries());

    invoiceData.esTipoB = esTipoB;
    invoiceData.totalNeto = parseFloat(invoiceData.totalNeto) || 0; // Asegurar que es número
    invoiceData.tipoIVA = parseFloat(invoiceData.tipoIVA) || 0;   // Asegurar que es número
    invoiceData.importeIVA = parseFloat(document.getElementById('importeIVA').value) || 0;
    invoiceData.urlPDF = document.getElementById('idPdfSeleccionado').value;
    invoiceData.nombreOriginalPDF = document.getElementById('nombreOriginalPdfSeleccionado').value; // Para el renombrado      

    // Añadir los datos del proveedor desde la variable global 'selectedProviderInfo'
    if (selectedProviderInfo) {
      invoiceData.descripcionProveedorSheet = selectedProviderInfo.descripcion || "";
      invoiceData.familiasProveedorSheet = selectedProviderInfo.familias || [];
      invoiceData.tipoProveedorSheet = selectedProviderInfo.tipoProveedor || "";
    } else {
      // Si por alguna razón no hay proveedor seleccionado, enviar valores vacíos
      invoiceData.descripcionProveedorSheet = "";
      invoiceData.familiasProveedorSheet = [];
      invoiceData.tipoProveedorSheet = "";
      console.warn("collectAndSaveInvoiceData: No se encontró 'selectedProviderInfo'. Los datos del proveedor (desc, familias, tipo) se enviarán vacíos.");
    }      

    // Recolectar datos de la asignación a nivel factura (si aplica)
    const fieldsetAsignacionFactura = document.getElementById('fieldsetAsignacionFactura');
    invoiceData.tieneDetalles = true; // Asumimos que tiene detalles por defecto

    if (fieldsetAsignacionFactura && fieldsetAsignacionFactura.style.display !== 'none') {
        invoiceData.tieneDetalles = false; // No tiene detalles, se usa asignación a nivel factura
        invoiceData.conceptoNivelFactura_familia = document.getElementById('conceptoFamilia_FacturaNivel')?.value;
        invoiceData.conceptoNivelFactura_tipo = document.getElementById('conceptoTipo_FacturaNivel')?.value;
        if (invoiceData.conceptoNivelFactura_tipo === 'Material') {
            invoiceData.conceptoNivelFactura_categoria = document.getElementById('conceptoCategoriaMaterial_FacturaNivel')?.value;
        }
        invoiceData.conceptoNivelFactura_descripcion = document.getElementById('conceptoDescripcionDetallada_FacturaNivel')?.value;
        invoiceData.conceptoNivelFactura_sede = document.getElementById('conceptoSede_FacturaNivel')?.value;
        
        const expFacturaInput = document.getElementById('conceptoExpedienteInput_FacturaNivel')?.value;
        invoiceData.conceptoNivelFactura_expediente = expFacturaInput ? expFacturaInput.split(' - ')[0] : '';
    }


    // Recolectar detalles de factura
    invoiceData.detalles = [];
    const detailRows = document.querySelectorAll('.detail-row'); // Cambiado a .detail-row
    detailRows.forEach((rowWrapper) => { // Cambiado a rowWrapper
        // El idSuffix ahora lo tomamos del id del wrapper, ej. detailRowWrapper_1
        const detailIdSuffix = rowWrapper.id.split('_')[1]; 
        
        const tipoConceptoDetalle = document.getElementById(`conceptoTipo_${detailIdSuffix}`)?.value;
        const categoriaMaterialDetalle = (tipoConceptoDetalle === 'Material') 
                                    ? document.getElementById(`conceptoCategoriaMaterial_${detailIdSuffix}`)?.value 
                                    : null;

        const detalle = {
            familia: document.getElementById(`conceptoFamilia_${detailIdSuffix}`)?.value,
            tipoConcepto: tipoConceptoDetalle,
            categoriaMaterial: categoriaMaterialDetalle,
            descripcionDetallada: document.getElementById(`conceptoDescripcionDetallada_${detailIdSuffix}`)?.value,
            sede: document.getElementById(`conceptoSede_${detailIdSuffix}`)?.value,
            expediente: document.getElementById(`conceptoExpedienteInput_${detailIdSuffix}`)?.value.split(' - ')[0],
            importeParcialNeto: parseFloat(document.getElementById(`detalleImporteNeto_${detailIdSuffix}`)?.value) || 0
        };
        invoiceData.detalles.push(detalle);
    });
    
    // *** Validación de Sumas ***
    const netoCabecera = invoiceData.totalNeto; // Ya es un número
    const sumaDetalles = parseFloat(document.getElementById('sumaDetallesNeto').value) || 0;

    // Solo validar si la factura indica que debería tener detalles
    // (es decir, si la sección de asignación a nivel factura ESTÁ oculta)
    const seEsperanDetalles = fieldsetAsignacionFactura && fieldsetAsignacionFactura.style.display === 'none';

    if (seEsperanDetalles && invoiceData.detalles.length === 0) {
        hideSpinner();
        alert("¡Atención! No se han añadido detalles a la factura, pero se esperaba que los tuviera. Por favor, añada detalles o revise la asignación a nivel de factura.");
        return null; // Devolver null para indicar error de validación y no solo false
    }
    
    if (seEsperanDetalles && invoiceData.detalles.length > 0 && Math.abs(netoCabecera - sumaDetalles) >= 0.01) {
        hideSpinner();
        alert(`¡Atención! El Total Neto de la Factura (${netoCabecera.toFixed(2)}) no coincide con la Suma de los Detalles (${sumaDetalles.toFixed(2)}). Por favor, revise los importes.`);
        return null; // Devolver null para indicar error de validación
    }

    // Si no se esperan detalles (se usa asignación a nivel factura),
    // nos aseguramos de que no haya detalles "huérfanos" por error.
    if (!seEsperanDetalles && invoiceData.detalles.length > 0) {
        hideSpinner();
        alert("¡Atención! Hay una asignación a nivel de factura, pero también se encontraron detalles. Por favor, elimine los detalles o la asignación a nivel de factura para evitar inconsistencias.");
        return null; // Devolver null para indicar error de validación
    }


    console.log("Datos de factura recolectados y validados:", invoiceData);
    return invoiceData; // Devolver el objeto de datos si todo está bien
}


/**
 * Callback para cuando el guardado de la factura tiene éxito.
 * Muestra un modal con opciones en lugar de un simple alert.
 * Preserva la lógica para "Guardar y Nuevo".
 */
function onSaveSuccess(response) {
  hideSpinner();

  if (response.success) {
    // --- Preparar elementos del modal ---
    const modal = document.getElementById('modalExito');
    const tituloModal = document.getElementById('modalExitoTitulo');
    const mensajeModal = document.getElementById('modalExitoMensaje');
    const opcionesDiv = document.getElementById('modalExitoOpciones');
    const cerrarBtn = document.getElementById('btnCerrarModalExito');
    
    // Personalizar el mensaje del modal con los datos devueltos
    tituloModal.textContent = "¡Factura Guardada!";
    mensajeModal.textContent = "La factura con Nº de Registro '" + (response.numeroRegistro || "N/A") + "' ha sido registrada.";
    
    opcionesDiv.innerHTML = ''; // Limpiar opciones previas

    // --- 1. Lógica para Renombrar y Estampar el PDF (si existe) ---
    const idPdf = response.pdfFileId; // ID del archivo, viene del servidor
    const nombreOriginalPdf = document.getElementById('nombreOriginalPdfSeleccionado').value; // Se obtiene del campo oculto

    if (idPdf && nombreOriginalPdf) {
      // a) Renombrar el archivo en Drive para marcarlo como registrado (operación de fondo)
      google.script.run
        .withSuccessHandler(function(renameResponse){
          if(renameResponse.success){
            console.log("PDF renombrado con éxito:", renameResponse.nuevoNombre);
            // Recargar la lista de PDFs para que el archivo renombrado ya no aparezca
            cargarListaPdfsPendientes('');
          } else {
            console.error("Error al renombrar PDF:", renameResponse.message);
            // Mostrar un error no bloqueante, ya que la factura sí se guardó
            alert("AVISO: La factura se guardó, pero hubo un error al marcar el PDF como registrado: " + renameResponse.message);
          }
        })
        .withFailureHandler(function(err){
          console.error("Fallo crítico al intentar renombrar PDF:", err);
          alert("AVISO: La factura se guardó, pero hubo un fallo crítico al marcar el PDF como registrado: " + err.message);
        })
        .marcarPdfComoRegistrado(idPdf, nombreOriginalPdf);
      
      // b) Crear el botón "Imprimir con Sello" y añadirlo al modal
      const btnEstampar = document.createElement('button');
      btnEstampar.id = 'btnEstamparPdfModal';
      btnEstampar.textContent = 'Imprimir con Sello';
      btnEstampar.className = 'button-primary';
      opcionesDiv.appendChild(btnEstampar);

      btnEstampar.onclick = function() {
        showSpinner(); // Mostrar spinner mientras se estampa
        modal.style.display = 'none'; // Ocultar modal de éxito
        
        google.script.run
          .withSuccessHandler(onPdfEstampadoSuccess)
          .withFailureHandler(error => {
              hideSpinner();
              alert("Error crítico al estampar el PDF: " + error.message);
          })
          .estamparYPrepararPdfParaImprimir(idPdf, response.numeroRegistro);
      };
    }
    
    // --- 2. Lógica para el botón "Cerrar" del modal (contiene tu lógica de reset) ---
    cerrarBtn.onclick = function() {
      modal.style.display = 'none';
      const divInfoPdf = document.getElementById('pdfSeleccionadoInfo');

      if (response.esGuardarYNuevo && selectedProviderInfo) {
          // LÓGICA DE "GUARDAR Y NUEVO DEL MISMO PROVEEDOR"
          const provInfo = { ...selectedProviderInfo };
          const cif = document.getElementById('cifProveedor').value;
          const razon = document.getElementById('razonSocialProveedor').value;
          const comercial = document.getElementById('nombreComercialProveedor').value;
          const tipoProv = document.getElementById('tipoProveedorDetectado').value;

          document.getElementById('invoiceForm').reset();
          
          document.getElementById('cifProveedor').value = cif;
          document.getElementById('razonSocialProveedor').value = razon;
          document.getElementById('nombreComercialProveedor').value = comercial;
          document.getElementById('tipoProveedorDetectado').value = tipoProv;
          selectedProviderInfo = { ...provInfo };
          if (divInfoPdf) divInfoPdf.innerHTML = '';

          document.getElementById('invoiceDetailsContainer').innerHTML = '';
          updateTotalNetoDetalles();
          toggleAsignacionFacturaFields();

          const containerFacturaNivel = document.getElementById('conceptoContainerFacturaNivel');
          if (containerFacturaNivel) {
              createConceptEntry('FacturaNivel', containerFacturaNivel);
              if (selectedProviderInfo) {
                  prefillConceptFamiliaAndTipo('FacturaNivel', selectedProviderInfo.familias, selectedProviderInfo.tipoProveedor);
              }
          }
          document.getElementById('numeroRegistroManual').focus();
      } else {
          // LÓGICA DE "GUARDAR" NORMAL (LIMPIEZA TOTAL)
          document.getElementById('invoiceForm').reset();
          selectedProviderInfo = null;
          document.getElementById('invoiceDetailsContainer').innerHTML = '';
          if (divInfoPdf) divInfoPdf.innerHTML = '';
          updateTotalNetoDetalles(); 
          toggleAsignacionFacturaFields();
          const containerFacturaNivel = document.getElementById('conceptoContainerFacturaNivel');
          if (containerFacturaNivel) {
              createConceptEntry('FacturaNivel', containerFacturaNivel);
          }
      }
      actualizarComparacionNetos();
    };
    
    // --- 3. Mostrar el modal ---
    modal.style.display = 'flex';

  } else {
    // Manejar el caso en que el guardado inicial falló
    alert("Error al guardar la factura: " + (response.message || "Error desconocido."));
  }
}

function onSaveFailure(error) {
    hideSpinner();
    document.body.classList.remove('saving'); // Asegúrate de quitar esto también en caso de fallo
    alert("Error crítico al guardar la factura: " + error.message);
    console.error("Error en llamada a saveInvoiceDataToFirebase:", error);
}

/**
 * Callback para cuando el estampado del PDF tiene éxito.
 */
function onPdfEstampadoSuccess(response) {
  hideSpinner();
  if (response.success && response.url) {
    const pdfWindow = window.open(response.url, '_blank');
    if (!pdfWindow) {
        alert("El navegador bloqueó la ventana emergente. Por favor, permita las ventanas emergentes para este sitio para poder imprimir. La URL del PDF estampado es: " + response.url);
    }
  } else {
    alert("Error al estampar el PDF: " + response.message);
  }
}

// --- Funciones para Modales ---
function openModal(modalId) {
  document.getElementById(modalId).style.display = 'flex';
}
function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

// --- Spinner de Carga (simple) ---
function showSpinner() {
  let spinner = document.getElementById('loadingSpinner');
  if (!spinner) {
      spinner = document.createElement('div');
      spinner.id = 'loadingSpinner';
      spinner.textContent = 'Cargando...'; // Puedes mejorarlo con un GIF o CSS
      // Estilos básicos para el spinner (añadir a CSS.html)
      // #loadingSpinner { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      //                  background: rgba(0,0,0,0.7); color: white; padding: 20px; border-radius: 5px; z-index: 1000; }
      document.body.appendChild(spinner);
  }
  spinner.style.display = 'block';
}
function hideSpinner() {
  const spinner = document.getElementById('loadingSpinner');
  if (spinner) {
      spinner.style.display = 'none';
  }
}
