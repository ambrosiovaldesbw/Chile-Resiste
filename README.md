# Chile Resiste

**Taller de Diseño de Interfaces · Universidad Adolfo Ibáñez**  
Proyecto universitario en el contexto del concurso **Chile Re-Descubre**.

**Chile Resiste** es un simulador educativo 3D de terremotos y tsunamis con exploración y controles por cámara. Compara la respuesta de dos torres para observar cómo la disipación de energía afecta el movimiento de los edificios.

[Abrir el simulador de Chile Resiste](https://ambrosiovaldesbw.github.io/Chile-Resiste/)

## Tema elegido

Desarrollo chileno de sistemas de disipación de energía sísmica en edificios de altura. El caso de estudio es la Torre Titanium La Portada, en Santiago.

## Descripción conceptual

**Chile Resiste** es una experiencia audiovisual en una ciudad costera ficticia inspirada en Viña del Mar y Valparaíso. Dos torres de igual altura y geometría reciben una señal sísmica común. La torre naranja representa una estructura sin disipadores adicionales. La torre celeste incorpora mayor amortiguamiento y muestra, mediante crucetas y placas en U, cómo pueden integrarse disipadores metálicos en una estructura.

El modelo usa osciladores por eje con la misma masa y rigidez conceptual en ambas torres. El movimiento lateral de la palma genera una señal de base común. Su intensidad aumenta al mover la mano más rápido y con mayor amplitud, y decae cuando la mano permanece quieta. El amortiguamiento es la diferencia entre las torres. **Registro** muestra el componente lateral y los indicadores conservan el máximo de la respuesta combinada, en unidades arbitrarias.

La ola representa un caso posible de tsunami tras el desplazamiento submarino del fondo oceánico. Pasa por una alteración inicial, una retirada posible del mar, el avance, la inundación y el retroceso. La sacudida intensa y sostenida provoca grietas, caídas de objetos, rotura de ventanas y colapsos en edificios secundarios. La ola inunda las calles y desplaza o derriba autos, palmeras y mobiliario al avanzar. Al retroceder, el agua se retira y los daños quedan visibles. Los terremotos, el tsunami y sus daños son representaciones educativas sin validación física ni estructural. Los disipadores actúan sobre las vibraciones sísmicas. La inundación requiere medidas de protección distintas.

## Instrucciones de uso

1. Abre el simulador en un navegador con WebGL 2 y conexión a Internet. Usa el sitio HTTPS para acceder a la cámara. **Pantalla completa** oculta el marco del navegador.
2. Elige **Terremoto**, **Tsunami** o **Exploración** en la barra flotante. **Información** abre el panel científico. **Controles** abre la guía y la calibración. **Registro** abre el gráfico del terremoto.
3. En **Terremoto**, pulsa **Iniciar** y ajusta **Intensidad**. **Detener** congela la simulación y el registro. **Continuar** reanuda la prueba. **Reiniciar** limpia las lecturas y devuelve la intensidad y la cámara a sus valores iniciales.
4. En **Tsunami**, pulsa **Iniciar ola**. **Altura**, **Velocidad manual** y **Ancho** ajustan la demostración. **Detener** pausa en la fase actual. **Reiniciar** restablece la ola.
5. **Reconstruir** restaura la ciudad y ambos desastres desde cualquier modo. Los reinicios individuales de Terremoto y Tsunami conservan el daño acumulado. Activa **Sonido** para oír el ambiente y el fenómeno activo.

### Recorrido y realidad virtual

- **Exploración** permite elegir **Exterior**, **Calle**, **Playa**, **Vista aérea** y las oficinas de las dos torres. Arrastra o usa las flechas para mirar, usa la rueda o **+** / **−** para acercar y alejar, y **WASD** para caminar en la calle, la playa o las oficinas. **Inicio** vuelve al exterior. También puedes hacer clic directamente sobre una torre.
- Las oficinas del último piso tienen mobiliario, lámparas que oscilan y ventanales hacia la costa y la otra torre. El punto de vista usa la oficina como referencia y las transiciones de escritorio se hacen por fundido.
- En un navegador y visor compatibles, ejecuta el sitio sobre **HTTPS** o **localhost** y pulsa **Entrar en VR**. El panel 3D ofrece modos, miradores, reconstrucción y controles de simulación. Puedes seleccionar con el gatillo o mantener el cursor sobre un objetivo durante 2 s con el índice si la webcam está disponible durante la sesión. Activa la cámara antes de entrar para usar gestos. La cabeza controla la orientación. En Exploración puedes usar la profundidad de una palma para desplazarte a velocidad reducida.

### Cámara y gestos

Pulsa **Activar cámara** desde **HTTPS** o **localhost** y concede el permiso. En **Controles**, usa **Calibrar centro** y mantén una o ambas palmas abiertas y quietas frente al pecho. Puedes minimizar la vista previa mientras el seguimiento continúa. El video se procesa localmente.

#### Gestos globales

| Gesto | Acción |
| --- | --- |
| Índice y medio durante 0,8 s | Avanzar en el ciclo Terremoto → Tsunami → Exploración → Terremoto. Suelta el gesto antes de avanzar otra vez. |
| Cuatro dedos con el pulgar recogido durante 0,8 s | Pasar al siguiente mirador. El recorrido comienza en Exterior y sigue por Calle, Playa, Interior naranja, Interior celeste y Vista aérea. |
| Índice extendido | Mover el cursor por la pantalla. Mantén el cursor 2 s sobre un botón, menú, control, mirador o edificio para activarlo. El círculo indica el progreso y el botón se resalta. |
| Ambas palmas abiertas durante 3 s | Reconstruir la ciudad en cualquier modo. Retirar una palma cancela la cuenta regresiva. |

Retira el cursor del objetivo para cancelar la cuenta o para volver a seleccionarlo. En un deslizador, mantén el cursor sobre el punto que quieres ajustar. El reconocimiento prioriza la reconstrucción, los cambios, la detención, la selección y los controles continuos, en ese orden.

#### Controles por modo

Abre una sola palma con los cinco dedos separados al empezar. Al cambiar de modo se detienen los controles del anterior. Retira el gesto y vuelve a mostrar la palma para activar el modo nuevo. Conservarás los daños y el seguimiento de la cámara. El puño detiene inmediatamente el modo actual. Abre otra vez la palma para reactivarlo.

| Modo | Controles con una sola palma |
| --- | --- |
| **Terremoto** | Mueve la mano lateralmente de izquierda a derecha o al revés. Un desplazamiento más rápido y amplio genera mayor intensidad. Al dejar la mano quieta, la señal y la oscilación decaen. Ambas torres reciben la misma excitación lateral. |
| **Tsunami** | Sube o baja la palma para cambiar la altura. Acércala para que la ola avance hacia la ciudad y aléjala para que retroceda hacia el mar. Cuanto mayor sea el cambio de distancia, mayor es la velocidad en ese sentido. En la distancia neutra, la ola se queda en su sitio. La trayectoria es perpendicular a la costa. |
| **Exploración** | Desplaza la palma a la izquierda o derecha para girar y hacia arriba o abajo para mirar. Acércala para avanzar por el escenario y aléjala para retroceder. Mantén la mano desplazada para continuar y vuelve al centro para detenerte. Usa Calle o Playa para recorrer el suelo y selecciona una torre para entrar a su oficina. |

Puedes usar cualquiera de las dos manos. Cada activación toma como referencia una palma quieta o el centro guardado con **Calibrar centro**. Para calibrar, coloca la mano en una posición neutra cómoda, deja espacio para acercarla y alejarla y mantenla quieta hasta la confirmación. Ajusta **Sensibilidad** según la distancia a la cámara. Cuando se pierde el seguimiento, el control activo por palma se detiene.

**Controles → Diagnóstico de gestos** muestra los detalles de cada mano y registra sus acciones. El simulador muestra el modo activo, el gesto, la intensidad sísmica, el estado y la altura de la ola o el desplazamiento de la cámara según corresponda.

Para servir el proyecto en local, si ya tienes Python, ejecuta `python -m http.server 8000` en la carpeta y abre `http://localhost:8000/`.

### Publicación en GitHub Pages

El sitio se publica desde `main` y la carpeta raíz del repositorio. `index.html` contiene la interfaz y carga `chile-resiste.js` con una versión en la URL. El script genera la escena 3D. El navegador descarga A-Frame, MediaPipe y el modelo de manos desde direcciones HTTPS. La cámara solicita permiso al pulsar **Activar cámara** y procesa el video en el navegador. [Configuración de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Tecnologías

- HTML y CSS en `index.html`, con la aplicación en `chile-resiste.js`.
- [A-Frame 1.7.1](https://aframe.io/docs/1.7.0/introduction/) para integrar la escena en el navegador y Three.js, incluido en A-Frame, para construir el escenario, iluminarlo y animarlo.
- [WebXR](https://aframe.io/docs/1.7.0/components/webxr.html) para el visor de realidad virtual y sus mandos.
- MediaPipe Tasks Vision **0.10.21**, con JavaScript y WASM de la misma versión en jsDelivr y el modelo Hand Landmarker de Google AI Edge para dos manos. El clasificador del proyecto usa los 21 landmarks de cada mano. La descarga se realiza al activar la cámara. [Documentación de Hand Landmarker para web](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker?tab=Web)
- Canvas 2D para el gráfico y el seguimiento visual. Web Audio API sintetiza viento, mar, ola y terremoto.
- Geometría procedural, instancias para elementos urbanos y fragmentos reutilizables, umbrales de daño por exposición y shaders para cielo y océano. La propagación de la ola se aproxima mediante funciones analíticas.
- Sitio estático compatible con GitHub Pages. No requiere backend, instalación de dependencias ni archivos de modelos 3D o audio.

## Fuentes

- SIRVE describe el sistema metálico de la Torre Titanium, su ubicación en crucetas y muros, y el reconocimiento Avonni. [Premio Avonni 2010](https://www.sirve.cl/premios/avonni-2010/)
- Ingeniería UC documenta la trayectoria de Juan Carlos de la Llera y el desarrollo de sistemas de protección sísmica. [Perfil académico](https://www.ing.uc.cl/academicos-e-investigadores/juan-carlos-de-la-llera-martin/)
- CONICYT documenta los proyectos Fondef, la transferencia tecnológica a SIRVE y las aplicaciones en la Torre Titanium y el edificio Parque Araucano. [El ingenio de un proyecto financiado por CONICYT](https://www.conicyt.cl/blog/2010/04/05/el-ingenio-de-un-proyecto-financiado-por-conicyt-que-el-terremoto-no-destruyo/)
- SENAPRED describe señales naturales como una retirada inusual del mar. [Tsunami](https://senapred.cl/tsunami/)
- USGS explica la deformación del fondo marino, la propagación y el avance del agua hacia tierra. [Life of a Tsunami](https://www.usgs.gov/centers/pcmsc/life-tsunami)

## Cápsula audiovisual de un minuto

| Tiempo | Qué mostrar |
| --- | --- |
| 0:00–0:09 | Muestra la ciudad costera e identifica la torre celeste con disipadores. |
| 0:09–0:29 | Abre la palma, muévela lateralmente y compara ambas torres. Cierra el puño y vuelve a abrirlo para demostrar la reactivación. |
| 0:29–0:45 | Apunta a una perspectiva durante 2 s. Pasa al tsunami con el índice y el medio. |
| 0:45–1:00 | Muestra la ola y cómo reacciona el mobiliario. Reconstruye la ciudad y menciona el alcance educativo del caso Titanium. |

[Video de funcionamiento de Chile Resiste (60 segundos)](https://github.com/ambrosiovaldesbw/Chile-Resiste/releases/download/video-unidad-3/Chile_Resiste_final.mp4)
