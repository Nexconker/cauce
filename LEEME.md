# Cauce · Nex-Industries

Un EPANET más claro para trabajar modelos de redes de agua, de cualquier red y en cualquier sistema de unidades.
Usa el mismo motor de cálculo del programa EPANET (versiones 2.2 y 2.3, en `motor/`) y corre entero en tu PC:
los `.inp` no salen de tu equipo.

## Cómo se abre

- **Acceso directo "Cauce"** en el escritorio o en el menú Inicio. Abre Cauce en su propia ventana (sin consola
  ni nada de Edge), con la presentación de Nex-Industries. Si ya está abierto, lo trae al frente. El servidor se
  apaga solo un minuto y medio después de cerrar la ventana (si no hay una corrida en curso). Si se pierden los
  accesos, `Instalar accesos.bat` los vuelve a crear.
- `Iniciar Cauce.bat`: lo mismo, pero con una consola visible (útil si algo falla) y en el navegador normal.
- **Salir** (arriba a la derecha) o la X de la ventana cierran Cauce. Si un modelo tiene cambios sin guardar (punto
  en su pestaña), pregunta antes: guardar, salir sin guardar o cancelar. Lo mismo al cerrar la pestaña de un modelo.
  Si la página se trabara, tres clics seguidos en la X cierran igual.

Necesita Python con `pywebview` (la ventana propia; sin él abre en modo ventana de Edge) y `openpyxl` (importar
Excel).

## Qué hace

- **Modelo**: abre uno o varios `.inp` (pestañas arriba), con conteos, opciones explicadas y exportación. Al volver
  a una pestaña, el mapa (2D o 3D) y el elemento elegido quedan como estaban.
- **Nuevo**: empieza un modelo desde cero (nombre, unidades y fórmula de pérdidas, y dónde guardarlo). Abre con la
  edición puesta: un embalse o tanque, nudos y tuberías. A diferencia de los `.inp` que vienen de afuera, este sí
  se guarda en su propio archivo (Guardar o Ctrl+S); los demás nunca se sobrescriben.
- **Unidades del propio .inp**: con LPS, LPM, MLD, CMH o CMD trabaja en metros, milímetros y presión en metros;
  con GPM, CFS, MGD, IMGD o AFD, en pies, pulgadas y psi. Todas las etiquetas, leyendas y formularios lo siguen.
- **Mapa**: la red con sus vértices; colorea por tipo y diámetro, por horizonte de proyecto (el año de las
  etiquetas), por estado inicial, por resultados o por diferencias. Buscador con `/`.
- **Revisión**: antes de correr, lo que hace fallar a EPANET o lo vuelve lento (islas, nudos sueltos, proyectos sin
  entrada, tanques unidos sin control, cotas en 0, bombas sin curva...), con qué hacer y arreglos de un clic. Cada
  hallazgo es una fila (color, título, cuántos elementos y «Ver»); al tocarla se despliega la explicación. También
  lo que suele encontrarse a mano al revisar versiones de un modelo grande: obras de un quinquenio posterior prendidas con otras
  anteriores apagadas, bombas cuya curva no alcanza a subir el agua al tanque, reglas de nivel fuera del rango del
  tanque o que lo dejan casi vacío, reglas que mandan una bomba a más de 5 km de su tanque (el ID de otra estación),
  tuberías abiertas dibujadas una encima de otra y patrones que nadie usa.
- **Correr**: motor 2.2 (el del programa de escritorio) o 2.3 (más rápido): tiempo, pasos, convergencia, balance
  producción/consumo, avisos explicados, qué oscila, tanques en el límite y, si falla, en qué nudo.
- **Escenario**: una capa de cambios sobre el archivo base, sin copiar `.inp`: proyectos por horizonte o por grupo,
  estados, consignas, demandas desde Excel, multiplicador, ACCURACY/TRIALS, sin calidad del agua.
- **Armar quinquenio** (panel Escenario): eliges el año y arma un escenario nuevo con las obras hasta ese año
  prendidas y las de después apagadas (con una entrada a cada parte sin tanque), los `.scn` que van desde ese año y
  la demanda del año. La demanda sale de un Excel con nudo, sector y ponderación y otra hoja con la demanda de cada
  sector por año (como una distribución de demanda proyectada por sectores). Las tuberías que cambia un `.scn` nunca se
  apagan (existen antes de su año) y las bombas de lo que se prende quedan como en el archivo (las manejan sus
  reglas). Antes de armarlo muestra qué va a hacer; la configuración es una sola para todos los modelos.
- **Escenario de EPANET (.scn)** (panel Escenario, «Elegir .scn…»): carga lo mismo que EPANET con File › Import ›
  Scenario: diámetros, rugosidades, demandas (con sus categorías), calidad inicial, reacciones, controles y reglas.
  Antes de aplicar muestra qué cambia y de qué a qué (por ejemplo «60 de 2.000 a 1.800 mm»), los elementos que no
  están en el modelo (se puede aplicar sin ellos) y lo que no entiende, en vez de saltarlo callado. Entra como una
  sola edición del escenario, se resalta en el mapa y Ctrl+Z la quita entera; el `.inp` no se toca.
- **Editar red** (botón sobre el mapa o tecla `E`): nudo, tubería, tanque, embalse, válvula, bomba, partir, unir,
  mover y borrar, cada uno con su símbolo y su letra. La cota se estima con los vecinos; todo se deshace con Ctrl+Z.
  **Long. auto** (en la misma barra): al mover o unir nudos, las tuberías conectadas toman la longitud del dibujo,
  como el Auto-Length de EPANET. Viene prendida en los modelos hechos en Cauce y apagada en los demás, para no
  cambiar sin querer las longitudes de un modelo calibrado.
- **Datos**: patrones (tabla y gráfica, pegar desde Excel), curvas de bombas, eficiencia, volumen y pérdida
  (con la curva que arma EPANET para bombas de un punto), controles y reglas (con ayuda de sintaxis y una forma de
  agregarlos), todas las opciones de cálculo, tiempos, calidad del agua, reacciones y energía, y los rótulos del
  mapa. EPANET revisa cada cambio: si lo dejara sin abrir, no se aplica y se ve el error.
- **Calidad del agua**: cloro (o cualquier químico), edad del agua o rastreo desde un nudo. Calidad inicial,
  fuentes, emisores, mezcla en tanques y reacciones de cada elemento en su ficha. Se ve en el mapa, en la barra de
  tiempo y en las gráficas, igual que la presión.
- **Energía** (en Informes › Energía): uso, eficiencia, kWh por m³ (o por Mgal), kW medio y pico, y costo de cada
  bomba, con la curva de eficiencia, el precio y su patrón; se ordena por cualquier columna y se exporta a CSV.
- **Consignas**: corrida con los patrones en 1 para proponer las consignas de las FCV que llenan cada tanque.
- **Comparar**: qué cambió entre dos modelos o escenarios, marcado en el mapa.
- **Informes**: perfil de terreno y línea de carga entre dos nudos (con la banda del día), frecuencia de presiones,
  velocidades o calidad, flujo del sistema (producción, consumo y tanques), tablas de nudos y tramos con filtro,
  orden y exportación a CSV para Excel, y el informe de energía. El panel abre ancho y **Ampliar** lo lleva a todo
  el ancho (el mapa vuelve al reducir); las tablas tienen su propio scroll con el encabezado y la primera columna
  fijos y muestran hasta 1.500 filas (el CSV las lleva todas).
- **Reportes de EPANET (.rpt)**, con su botón en la barra de la izquierda:
  - **Generar el reporte** del modelo abierto, con su escenario: motor 2.2 o 2.3, estado de cada paso (no, sí o
    completo con las iteraciones), resumen, energía, nudos y tramos (todos, ninguno o una lista de ID) y las
    variables de cada tabla. Corre aparte mostrando la hora que va calculando, pregunta antes de reemplazar un .rpt
    que ya exista y guarda los últimos generados para volver a leerlos.
  - **Leerlo** en una ventana grande de Cauce. «Leer el reporte de EPANET» en Correr abre el de la corrida que se
    está viendo; «Leer un .rpt» en Informes, en el inicio o en Reportes abre cualquier reporte del disco (también el
    de EPANET de escritorio), y se le puede soltar un archivo encima. Trae un resumen con los avisos por hora y por
    tipo, los avisos agrupados por elemento (veces, horas, primera y última, copiar para Excel), el paso a paso con
    los avisos y cambios de estado de cada paso, las tablas de resultados si el reporte las tiene (cada nudo o tramo
    hora a hora y los más bajos o altos de cada variable) y el texto completo con buscador y saltos a cada sección.
    Con un modelo abierto relacionado, cada elemento sale con su nombre y el botón **Mapa** lo muestra en el mapa;
    «Volver al reporte» lo deja como estaba. «En otra ventana» lo saca a una ventana aparte, para otra pantalla.
    Lee reportes de decenas de MB sin congelar la app.
- **Edición en grupo**: desde una tabla filtrada o encerrando un área del mapa (herramienta Área): poner,
  multiplicar o sumar diámetro, rugosidad, pérdida menor, longitud, estado, cota, demanda, patrón o etiqueta.
- **Mapa de fondo**: un plano o una foto aérea debajo de la red, ubicada con las coordenadas del modelo (en el
  panel Modelo). Por defecto el fondo es negro.
- **Scripts**: Python sobre la red, como el nodo de Python de Dynamo. El objeto `red` trae nudos, tramos, datos y
  resultados; se cambian asignando (`t.diametro = 300`, `red.cerrar('P1')`), se corre la red adentro del script
  (`r = red.correr()`) y se marcan elementos en el mapa. El script corre aparte (se puede cancelar), la consola se ve
  mientras corre y los cambios esperan a que les des Aplicar: quedan como una sola edición que Ctrl+Z deshace
  entera. Trae ejemplos (presiones bajas, velocidades altas, tanques que se vacían, barrido de consignas de una FCV…)
  y guarda los tuyos en `trabajo/scripts`.
- **Vista 3D** (botón 3D sobre el mapa o tecla `3`): la red a su cota con exageración vertical, tanques con su
  nivel, embalses y, con una corrida, el agua moviéndose por las tuberías a su velocidad, siguiendo la barra de
  tiempo. Colorea por presión o por velocidad; al pasar el mouse muestra el dato y con clic abre la ficha.
  Se edita con las mismas herramientas de Editar red (tecla `E`): nudo, tubería, partir, válvula, bomba, unir,
  mover arrastrando, área, borrar… Un clic en un sitio vacío cae a la cota de los nudos de alrededor.
- **Mover con coordenadas** (herramienta Mover, `M`): arrastrar sigue moviendo; un clic en un nudo, bomba o
  válvula (estas se mueven enteras, con sus dos nudos) abre una ficha
  donde eliges un origen (el mismo nudo, otro nudo o un punto, en 2D o en 3D) y escribes desde ahí ΔX (este),
  ΔY (norte) y ΔZ (cota), o directamente dónde queda. El destino se ve en el mapa mientras escribes; posición y
  cota quedan en una sola edición.
- **Inicio**: el logo de arriba a la izquierda vuelve a la pantalla de bienvenida sin cerrar nada; desde ahí (o
  con una pestaña) se regresa a cualquier modelo abierto.
- **Ajustes**: cómo lee Cauce los modelos de tu organización (regla del horizonte, proyectos por ID, sufijos y
  prefijos de elementos nuevos, clases de colores, meta del balance). Trae un preset genérico y el del Plan Maestro.
- **Glosario**: cada concepto, opción, resultado y aviso explicado.

## Atajos

`/` buscar · `E` editar · `3` vista 3D · `Espacio` reproducir o pausar el día · `[` plegar o desplegar el panel lateral · `Esc` soltar la herramienta · `Ctrl+Z` deshacer ·
`Ctrl+S` guardar el escenario (si ya tiene archivo, sin preguntar).
En el editor de scripts: `Ctrl+Enter` correr, `Ctrl+S` guardar el script, `Tab` y `Mayús+Tab` sangría, `Ctrl+/` comentar.
Con la edición abierta: `S` seleccionar, `M` mover, `N` nudo, `T` tubería, `K` tanque, `R` embalse, `V` válvula,
`B` bomba, `P` partir, `U` unir, `A` área (edición en grupo), `L` rótulo, `D` borrar.

## Lo que nunca hace

- No sobrescribe el archivo base ni un archivo existente sin preguntar.
- No escribe un `.inp` que EPANET 2.2 no pueda abrir (lo valida antes; si falla, muestra el error del motor).
- Lo que no se cambió queda byte a byte igual al original (incluidos los finales de línea).
- No atiende pedidos de otras páginas: el servidor solo responde a su propia ventana (127.0.0.1), así que una página
  de internet no puede correr scripts ni tocar archivos a través de él.

## Actualizaciones

El código está en GitHub: https://github.com/Nexconker/cauce (público). Cada vez que se abre, Cauce lee la versión
publicada y, si es más nueva que la suya (archivo `VERSION`), baja esa versión, la instala encima y arranca la nueva;
al entrar avisa «Cauce se actualizó a la versión…». No toca `trabajo/` (configuración, escenarios, scripts de cada
persona) ni `lib/` (los paquetes que instaló «Instalar Cauce.bat»). Sin internet abre la versión que tenga. Una
carpeta con `.git` (la de desarrollo) no se actualiza sola. Para apagarla: variable `CAUCE_SIN_ACTUALIZAR=1` o
`"actualizar": false` en `trabajo/config.json`.

Desde la 1.3.1, al cerrar la ventana el servidor de Cauce se apaga enseguida (antes seguía un minuto y medio, y si se
volvía a abrir en ese rato no buscaba la versión nueva); si al abrir encuentra vivo un servidor más viejo, lo apaga y
se actualiza. Con Cauce abierto, mira cada 6 horas si hay una versión nueva y avisa que hay que cerrarlo y volverlo a
abrir. La versión instalada se ve en la esquina de la pantalla de inicio y al fondo de Ajustes, con lo publicado, un
botón «Buscar ahora» y, si la última actualización falló, el motivo.

Publicar una versión (desde la carpeta del repositorio, con git y acceso a la cuenta):

    python -I scripts/publicar.py 1.2.0 "Qué cambió"

Sube a la vez el commit, la etiqueta `v1.2.0` y el release; los Cauce instalados la toman la próxima vez que se abran.
Si una versión necesita un paquete nuevo de Python, hay que volver a correr «Instalar Cauce.bat» (la actualización
solo cambia los archivos de Cauce).

## Marca

Identidad de Nex-Industries: rojo, negro y blanco, con el logo hexagonal (variante de seis ranuras). El logo se
genera desde su geometría con `python -I scripts/generar_marca.py` (`--hoja` muestra las alternativas).

## Para llevarlo a la oficina con más personas

Hoy es una herramienta personal: escucha solo en `127.0.0.1` y guarda escenarios y corridas en esta carpeta.
Para usarlo entre varios haría falta:

1. Correrlo en un equipo compartido y escuchar en la red (variable `CAUCE_PUERTO` y cambiar `HOST`).
2. Entrada con la cuenta de la empresa (no tiene usuarios ni permisos).
3. Escenarios en una carpeta común, con aviso cuando otra persona tiene el mismo abierto.
4. Corridas en cola, para que varias corridas largas no se peleen por el procesador.
5. Empaquetarlo como `.exe` para quien no tenga Python.
