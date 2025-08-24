/*
 * Minimal OrbitControls (RMB rotate-only) – MIT
 * Совместимо с глобальным THREE (UMD не требуется).
 * Возможности: вращение вокруг target правой кнопкой мыши, демпфирование, ограничение углов,
 * обновление через controls.update(). Зума/пана нет (по умолчанию), чтобы колесо было под «поезд».
 */
(function () {
  if (!window.THREE) throw new Error('OrbitControls: THREE not found');

  const EPS = 1e-6;
  const _spherical = new THREE.Spherical();
  const _sphericalDelta = new THREE.Spherical(0, 0, 0);
  const _panOffset = new THREE.Vector3();
  const _offset = new THREE.Vector3();
  const _quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)); // z-up hack
  const _quatInverse = _quat.clone().invert();

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function OrbitControls(camera, domElement) {
    if (!camera || !domElement) throw new Error('OrbitControls(camera, domElement)');

    this.object = camera;
    this.domElement = domElement;

    // публичные опции (совместимые по именам с three/examples)
    this.enabled = true;
    this.target = new THREE.Vector3();

    this.enableRotate = true;
    this.rotateSpeed = 0.9;

    this.enableZoom = false; // мы не используем, чтобы колесо листало «поезд»
    this.enablePan = false;

    this.enableDamping = true;
    this.dampingFactor = 0.08;

    this.minPolarAngle = 0;            // 0 — смотреть сверху «в пол»
    this.maxPolarAngle = Math.PI;      // π — снизу
    this.minAzimuthAngle = -Infinity;
    this.maxAzimuthAngle = Infinity;

    this.minDistance = 0;              // дистанцию не ограничиваем
    this.maxDistance = Infinity;

    // для совместимости с твоей инициализацией
    this.mouseButtons = { RIGHT: THREE.MOUSE.ROTATE };

    // внутренние
    let state = 'NONE';
    let rotateStart = new THREE.Vector2();
    let rotateEnd = new THREE.Vector2();
    let rotateDelta = new THREE.Vector2();

    const scope = this;

    // начальная сферическая
    this.updateSpherical = function () {
      _offset.copy(scope.object.position).sub(scope.target);
      _offset.applyQuaternion(_quat);
      _spherical.setFromVector3(_offset); // radius, phi(polar), theta(azimuth)
    };

    this.getPolarAngle = () => _spherical.phi;
    this.getAzimuthalAngle = () => _spherical.theta;

    this.update = function () {
      if (!scope.enabled) return;

      // демпфирование вращения
      if (scope.enableDamping) {
        _spherical.theta += _sphericalDelta.theta * scope.dampingFactor;
        _spherical.phi   += _sphericalDelta.phi   * scope.dampingFactor;
        _sphericalDelta.theta *= (1 - scope.dampingFactor);
        _sphericalDelta.phi   *= (1 - scope.dampingFactor);
      } else {
        _spherical.theta += _sphericalDelta.theta;
        _spherical.phi   += _sphericalDelta.phi;
        _sphericalDelta.set(0, 0, 0);
      }

      // ограничители
      _spherical.phi = clamp(_spherical.phi, scope.minPolarAngle, scope.maxPolarAngle);
      _spherical.theta = clamp(_spherical.theta, scope.minAzimuthAngle, scope.maxAzimuthAngle);
      _spherical.makeSafe();

      // применяем к положению камеры
      _offset.setFromSpherical(_spherical);
      _offset.applyQuaternion(_quatInverse);
      scope.object.position.copy(scope.target).add(_offset);
      scope.object.lookAt(scope.target);
    };

    function handleMouseDownRotate(event) {
      rotateStart.set(event.clientX, event.clientY);
    }
    function handleMouseMoveRotate(event) {
      rotateEnd.set(event.clientX, event.clientY);
      rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(scope.rotateSpeed / 600);

      // экран X → азимут, экран Y → полярный
      _sphericalDelta.theta -= rotateDelta.x * Math.PI;
      _sphericalDelta.phi   -= rotateDelta.y * Math.PI;

      rotateStart.copy(rotateEnd);
    }

    function onMouseDown(event) {
      if (!scope.enabled) return;
      // только ПРАВАЯ кнопка — вращение
      if (event.button === 2 && scope.enableRotate) {
        event.preventDefault();
        scope.updateSpherical();
        handleMouseDownRotate(event);
        state = 'ROTATE';
        window.addEventListener('mousemove', onMouseMove, false);
        window.addEventListener('mouseup', onMouseUp, false);
      }
    }
    function onMouseMove(event) {
      if (!scope.enabled) return;
      if (state === 'ROTATE') {
        handleMouseMoveRotate(event);
      }
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove, false);
      window.removeEventListener('mouseup', onMouseUp, false);
      state = 'NONE';
    }
    function onContextMenu(e) { e.preventDefault(); }

    // wheel/пан мы не используем — отданы приложению
    this.domElement.addEventListener('mousedown', onMouseDown, false);
    this.domElement.addEventListener('contextmenu', onContextMenu, false);

    // начальная инициализация
    this.updateSpherical();
  }

  // экспорт в THREE
  THREE.OrbitControls = OrbitControls;
})();
